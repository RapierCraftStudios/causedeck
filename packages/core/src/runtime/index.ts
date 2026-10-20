// `@causedeck/core/runtime` (#298): the app's runtime database seam. Apps never import `db` or
// `withWorkspace` from `@causedeck/db`; they call these services, which bind the app-role handle
// and run the core (or package) service on it. Importing this module opens nothing and reads no
// env (`db` connects on first use), so `next build` never needs runtime secrets. Each service loads
// its implementation on first call, so a page pulls in only what it uses.
import { db, isUuid as isUuidValue, withWorkspace, type Transaction } from '@causedeck/db';
import type { StorageCtx } from '@causedeck/storage';

import type {
  AccessDeniedEvent,
  AuditExportContext,
  AuditExportOptions,
  AuditPage,
  AuditQueryFilters,
  AuditReadContext,
} from '../audit/index.ts';
import type { InvoicePdfContext, SaasInvoicePdf } from '../billing/index.ts';
import type {
  AcceptInvitationRequest,
  AcceptedInvitation,
  CreateWorkspaceRequest,
  PreviewInvitationRequest,
} from '../workspaces/index.ts';

export type { Transaction };

/** The app-role database handle (lazy). Only for adapters that need a handle, e.g. Better Auth. */
export { db };

/** The acting user in one workspace: the RLS scope `inWorkspace` pins. */
export interface RuntimeScope {
  workspaceId: string;
  userId: string;
}

/** `true` for a canonical UUID string. */
export function isUuid(value: string): boolean {
  return isUuidValue(value);
}

/** Run `fn` in one transaction scoped to the workspace and acting user (`withWorkspace`). */
export function inWorkspace<T>(
  scope: RuntimeScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withWorkspace(db, scope, fn);
}

// workspaces

/** The user's role in the workspace, or `null` when not an active member of a live one. */
export async function memberRoleFor(userId: string, workspaceId: string) {
  const { memberRole } = await import('../workspaces/index.ts');
  return memberRole(db, userId, workspaceId);
}

/** The live workspace a slug points at; membership is the caller's check. */
export async function resolveSlugFor(slug: string, userId: string) {
  const { resolveSlug } = await import('../workspaces/index.ts');
  return resolveSlug(db, slug, userId);
}

/** The user's active memberships in live workspaces. */
export async function listMembershipsFor(userId: string) {
  const { listMemberships } = await import('../workspaces/index.ts');
  return listMemberships(db, userId);
}

/** Create a workspace owned by `request.userId`. */
export async function createWorkspaceFor(request: CreateWorkspaceRequest) {
  const { createWorkspace } = await import('../workspaces/index.ts');
  return createWorkspace(db, request);
}

/** Read-only look at an invitation for the signed-in user. */
export async function previewInvitationFor(request: PreviewInvitationRequest) {
  const { previewInvitation } = await import('../workspaces/index.ts');
  return previewInvitation(db, request);
}

/** Accept an invitation as the signed-in user (whose email must match), seats counted on the plan. */
export async function acceptInvitationFor(
  request: AcceptInvitationRequest,
): Promise<AcceptedInvitation> {
  const [{ acceptInvitation }, { installBillingEntitlements }] = await Promise.all([
    import('../workspaces/index.ts'),
    import('../billing/index.ts'),
  ]);
  installBillingEntitlements();
  return acceptInvitation(db, request);
}

/** Members and pending invitations, read in one workspace-scoped transaction. */
export async function loadMembersPage(scope: RuntimeScope) {
  const { listMembers, listPendingInvitations } = await import('../workspaces/index.ts');
  return inWorkspace(scope, async (tx) => ({
    members: await listMembers(tx, scope.workspaceId),
    invitations: await listPendingInvitations(tx, scope.workspaceId),
  }));
}

/** The workspace's members, read in its scope. */
export async function listMembersIn(scope: RuntimeScope) {
  const { listMembers } = await import('../workspaces/index.ts');
  return inWorkspace(scope, (tx) => listMembers(tx, scope.workspaceId));
}

// billing and usage

/** Subscription, seats in use and invoices, in one workspace-scoped transaction. */
export async function loadBillingPage(scope: RuntimeScope) {
  const [{ listSaasInvoices, loadSubscription }, { countBillableSeats }] = await Promise.all([
    import('../billing/index.ts'),
    import('../workspaces/index.ts'),
  ]);
  return inWorkspace(scope, async (tx) => ({
    subscription: await loadSubscription(tx, scope.workspaceId),
    seats: await countBillableSeats(tx, scope.workspaceId),
    invoices: await listSaasInvoices(tx, scope.workspaceId),
  }));
}

/** Every usage counter for `now`'s IST month, the AI budget and the plan's entitlements. */
export async function loadUsagePage(scope: RuntimeScope, now: Date) {
  const [{ getAiBudget, getUsage, USAGE_KEYS }, { getWorkspaceEntitlements }] = await Promise.all([
    import('../usage/index.ts'),
    import('../billing/index.ts'),
  ]);
  const { workspaceId } = scope;
  return inWorkspace(scope, async (tx) => {
    const ctx = { db: tx, workspaceId, now: () => now };
    // One after another: each read nests a savepoint on this transaction's connection.
    const counters: Partial<Record<(typeof USAGE_KEYS)[number], number>> = {};
    for (const key of USAGE_KEYS) counters[key] = await getUsage(ctx, key);
    const budget = await getAiBudget(ctx);
    const entitlements = await getWorkspaceEntitlements(tx, workspaceId, now);
    return { counters, budget, entitlements };
  });
}

/** The decrypted, audited PDF of one rendered invoice in the workspace; `null` when there is none. */
export async function openInvoicePdf(
  ctx: Omit<InvoicePdfContext, 'db'>,
  invoiceId: string,
): Promise<SaasInvoicePdf | null> {
  const { openSaasInvoicePdf } = await import('../billing/index.ts');
  return openSaasInvoicePdf({ db, ...ctx }, invoiceId);
}

// audit

/** `audit.read` for the user in the workspace: `NOT_FOUND` non-member, `FORBIDDEN` denied. */
export async function authorizeAuditReadFor(ctx: Omit<AuditReadContext, 'db'>) {
  const { authorizeAuditRead } = await import('../audit/index.ts');
  return authorizeAuditRead({ db, ...ctx });
}

/** One page of the activity feed (gated by `audit.read`). */
export async function queryAuditFeed(
  ctx: Omit<AuditReadContext, 'db'>,
  filters: AuditQueryFilters,
): Promise<AuditPage> {
  const { queryAudit } = await import('../audit/index.ts');
  return queryAudit({ db, ...ctx }, filters);
}

/** Authorize, then verify the workspace chain over `from`..`to`. */
export async function verifyAuditRange(ctx: Omit<AuditReadContext, 'db'>, from: Date, to: Date) {
  const { authorizeAuditRead, verifyChain } = await import('../audit/index.ts');
  await authorizeAuditRead({ db, ...ctx });
  return verifyChain(db, ctx.workspaceId, { from, to });
}

/** The audited export stream (permission checked and `audit.exported` recorded first). */
export async function exportAuditFor(
  ctx: Omit<AuditExportContext, 'db'>,
  options: AuditExportOptions,
): Promise<ReadableStream<Uint8Array>> {
  const { exportAudit } = await import('../audit/index.ts');
  return exportAudit({ db, ...ctx }, options);
}

/** `access.denied` in its own transaction (never throws): members' to the workspace chain. */
export async function recordAccessDeniedFor(event: AccessDeniedEvent): Promise<void> {
  const { recordAccessDenied } = await import('../audit/index.ts');
  return recordAccessDenied(db, event);
}

/**
 * `account.profile_updated` (account-level, informational) for the user's own profile change.
 * Metadata names the changed fields only, never their values (#289).
 */
export async function recordAccountProfileUpdatedFor(
  userId: string,
  fields: readonly string[],
  request: { requestId?: string; userAgent?: string } = {},
): Promise<void> {
  const { record } = await import('../audit/index.ts');
  await record(
    {
      db,
      workspaceId: null,
      actor: { userId, kind: 'user' },
      ...(request.requestId === undefined ? {} : { requestId: request.requestId }),
      ...(request.userAgent === undefined ? {} : { userAgent: request.userAgent }),
    },
    {
      action: 'account.profile_updated',
      target: { kind: 'user', id: userId },
      metadata: { fields: fields.join(',') },
    },
  );
}

// notifications, push, uploads, flags

/** The user's notification preferences, digest and settings, in one workspace-scoped transaction. */
export async function loadNotificationPreferences(scope: RuntimeScope) {
  const { getDigest, getNotificationSetting, getPreferences } =
    await import('@causedeck/notifications');
  const { workspaceId, userId } = scope;
  return inWorkspace(scope, async (tx) => {
    const ctx = { db: tx, workspaceId };
    return {
      preferences: await getPreferences(ctx, { userId }),
      digest: await getDigest(ctx, { userId }),
      settings: await getNotificationSetting(ctx, { userId }),
    };
  });
}

/** Store (or re-activate) the user's browser push subscription. */
export async function subscribePush(userId: string, input: unknown, userAgent: string | null) {
  const { saveSubscription } = await import('@causedeck/notifications/push');
  return saveSubscription(db, userId, input, userAgent);
}

/** Revoke the user's subscription for `endpoint`; `false` when they had no active one. */
export async function unsubscribePush(userId: string, endpoint: string): Promise<boolean> {
  const { revokeSubscription } = await import('@causedeck/notifications/push');
  return revokeSubscription(db, userId, endpoint);
}

/** A storage context on the app database for a checked member of `ctx.workspaceId`. */
export function uploadContext(ctx: Omit<StorageCtx, 'db'>): StorageCtx {
  return { ...ctx, db };
}

/** Count one request against `key`; `false` when over the limit. */
export async function consumeRequestLimit(
  key: string,
  limit: { max: number; windowSeconds: number },
): Promise<boolean> {
  const { consumeRateLimit } = await import('@causedeck/auth/rate-limit');
  return consumeRateLimit(db, key, limit);
}

/** `LISTEN flag_changed` on the app pool so flag changes drop the cache. Once per process. */
export async function startAppFlagListener(): Promise<unknown> {
  const { startFlagListener } = await import('@causedeck/flags');
  return startFlagListener(db);
}
