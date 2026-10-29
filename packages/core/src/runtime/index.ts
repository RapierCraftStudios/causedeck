// `@causedeck/core/runtime` (#298): the app's runtime database seam. Apps never import `db` or
// `withWorkspace` from `@causedeck/db`; they call these services, which bind the app-role handle
// and run the core (or package) service on it. apps/api and apps/worker use it too (#299). Importing this module opens nothing and reads no
// env (`db` connects on first use), so `next build` never needs runtime secrets. Each service loads
// its implementation on first call, so a page pulls in only what it uses.
import { isRole } from '@causedeck/auth';
import { assertCan, ForbiddenError } from '@causedeck/auth/policy';
import {
  authDb,
  closeDb,
  db,
  hasDedicatedAuthPool,
  isUuid as isUuidValue,
  probeDbPool,
  schema,
  withWorkspace,
  type Database,
  type Transaction,
} from '@causedeck/db';
import type { FlagListener } from '@causedeck/flags';
import type { ObjectKey, ObjectStore, StorageCtx } from '@causedeck/storage';
import type { ConfirmRosterImportInput } from '@causedeck/validators/roster';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';

import type { ActivityFilters } from '../automation/index.ts';
import type { CaptureCtx } from '../capture/index.ts';
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
  BenchChangeAlertRow,
  CourtEvents,
  RosterPreview,
  RosterWithEntries,
} from '../court/index.ts';
import type {
  AccountDeletionCtx,
  AccountDeletionJob,
  DeletionJob,
  DeletionRequestCtx,
  ExportDownload,
  ExportDownloadDeps,
  ExportDownloadLink,
  ExportJob,
  ExportRequestCtx,
  MemoryErasureCtx,
  MemoryErasureJob,
} from '../lifecycle/index.ts';
import type {
  GrantSessionInput,
  RequestSessionInput,
  SessionRef,
  StaffContext,
  SupportSession,
  SupportWorkspaceView,
  WorkspaceActorContext,
} from '../support/index.ts';
import type {
  AcceptInvitationRequest,
  AcceptedInvitation,
  CreateWorkspaceRequest,
  PreviewInvitationRequest,
} from '../workspaces/index.ts';

export type { Database, Transaction };

/** The app-role database handle (lazy). Only for adapters that need a handle, e.g. Better Auth. */
export { authDb, db };

/**
 * Report the runtime pool (and the dedicated auth pool when on) as metrics: connection wait and
 * idle-in-transaction signals for alerting (#805). `auth: false` skips the auth pool (the worker never
 * opens it). Call once after `initTelemetry`; without a metrics
 * provider it does nothing. Probes run on each metrics export, so it opens no connection at import.
 */
export async function startDbPoolMetrics(options: { auth?: boolean } = {}): Promise<void> {
  const { registerDbPoolMetrics } = await import('@causedeck/observability/db-pool-metrics');
  registerDbPoolMetrics({
    app: () => probeDbPool(db),
    ...((options.auth ?? true) && hasDedicatedAuthPool()
      ? { auth: () => probeDbPool(authDb) }
      : {}),
  });
}

export {
  createIdempotencyStore,
  IDEMPOTENCY_TTL_MS,
  IN_PROGRESS_STATUS,
  type ClaimInput,
  type IdempotencyRecord,
  type IdempotencyStore,
  type StoredApiResponse,
} from './idempotency-store.ts';

/** Close the app-role pool (graceful shutdown); `timeoutSec` bounds waiting for open queries. */
export function closeAppDb(options?: { timeoutSec?: number }): Promise<void> {
  return closeDb(options?.timeoutSec === undefined ? undefined : { timeout: options.timeoutSec });
}

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

/** `inWorkspace` on a handle the caller injected (the api's `requireWorkspace(db)`). */
export function inWorkspaceOn<T>(
  database: Database,
  scope: RuntimeScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withWorkspace(database, scope, fn);
}

// workspaces

/** The user's role in the workspace, or `null` when not an active member of a live one. */
export async function memberRoleFor(userId: string, workspaceId: string) {
  const { memberRole } = await import('../workspaces/index.ts');
  return memberRole(db, userId, workspaceId);
}

/** The user's role in the workspace and when it was granted (owner 2FA grace, #290), or `null`. */
export async function ownerGraceFor(userId: string, workspaceId: string) {
  const { ownerGrace } = await import('../workspaces/index.ts');
  return ownerGrace(db, userId, workspaceId);
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

/** Seats in use (active members by role) against the plan's `seats` and `clerk_seats`. */
export interface MembersSeatSummary {
  used: { total: number; clerk: number; nonClerk: number };
  granted: { seats: number; clerkSeats: number };
}

/**
 * Members, pending invitations and the seat summary at `now`, read in one workspace-scoped
 * transaction. The seat read runs in a savepoint: if the plan cannot be read, `seats` is `null`
 * and the members list still loads.
 */
export async function loadMembersPage(scope: RuntimeScope, now: Date = new Date()) {
  const [
    { countBillableSeats, listMembers, listPendingInvitations },
    { getWorkspaceEntitlements },
  ] = await Promise.all([import('../workspaces/index.ts'), import('../billing/index.ts')]);
  return inWorkspace(scope, async (tx) => {
    const members = await listMembers(tx, scope.workspaceId);
    const invitations = await listPendingInvitations(tx, scope.workspaceId);
    let seats: MembersSeatSummary | null;
    try {
      seats = await tx.transaction(async (sp) => {
        const { total, clerk, nonClerk } = await countBillableSeats(sp, scope.workspaceId);
        const entitlements = await getWorkspaceEntitlements(sp, scope.workspaceId, now);
        return {
          used: { total, clerk, nonClerk },
          granted: { seats: entitlements.seats, clerkSeats: entitlements.clerk_seats },
        };
      });
    } catch {
      seats = null;
    }
    return { members, invitations, seats };
  });
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

// support sessions (#313)

/** The owner's support settings page: pending requests and unexpired grants, newest first. */
export async function loadSupportPage(scope: RuntimeScope): Promise<SupportSession[]> {
  const { listSupportSessions } = await import('../support/index.ts');
  return inWorkspace(scope, (tx) => listSupportSessions(tx, scope.workspaceId));
}

/** The granted, unexpired session the product shell banner shows, or `null`. */
export async function activeSupportSessionIn(scope: RuntimeScope): Promise<SupportSession | null> {
  const { activeSupportSession } = await import('../support/index.ts');
  return inWorkspace(scope, (tx) => activeSupportSession(tx, scope.workspaceId));
}

/** Staff request a session; the owners' email deliveries go on the job queue. */
export async function requestSupportSessionFor(
  ctx: Omit<StaffContext, 'db'>,
  input: RequestSessionInput,
): Promise<SupportSession> {
  const [{ requestSession }, { enqueueNotificationDelivery }] = await Promise.all([
    import('../support/index.ts'),
    import('../jobs/index.ts'),
  ]);
  return requestSession(
    { db, ...ctx, enqueueDelivery: (job) => enqueueNotificationDelivery(job) },
    input,
  );
}

/** The owner grants a pending request (default 60 minutes, at most 240). */
export async function grantSupportSessionFor(
  ctx: Omit<WorkspaceActorContext, 'db'>,
  input: GrantSessionInput,
): Promise<SupportSession> {
  const { grantSession } = await import('../support/index.ts');
  return grantSession({ db, ...ctx }, input);
}

/** The owner turns down a pending request. */
export async function denySupportSessionFor(
  ctx: Omit<WorkspaceActorContext, 'db'>,
  input: SessionRef,
): Promise<SupportSession> {
  const { denySession } = await import('../support/index.ts');
  return denySession({ db, ...ctx }, input);
}

/** The owner (or the requesting staff member) ends a pending or granted session now. */
export async function revokeSupportSessionFor(
  ctx: Omit<WorkspaceActorContext, 'db'>,
  input: SessionRef,
): Promise<SupportSession> {
  const { revokeSession } = await import('../support/index.ts');
  return revokeSession({ db, ...ctx }, input);
}

// support sessions, staff side (#314)

/** The staff member's own support sessions in every workspace, newest first. */
export async function listStaffSupportSessionsFor(staffUserId: string): Promise<SupportSession[]> {
  const { listStaffSupportSessions } = await import('../support/index.ts');
  return listStaffSupportSessions(db, staffUserId);
}

/** One of the staff member's own support sessions, or `null`. */
export async function staffSupportSessionFor(
  staffUserId: string,
  sessionId: string,
): Promise<SupportSession | null> {
  const { staffSupportSession } = await import('../support/index.ts');
  return staffSupportSession(db, staffUserId, sessionId);
}

/** The read-only workspace view of a granted `view` session; every read audited `support.view`. */
export async function supportWorkspaceViewFor(
  ctx: Omit<StaffContext, 'db'>,
  workspaceId: string,
): Promise<SupportWorkspaceView> {
  const { readSupportWorkspaceView } = await import('../support/index.ts');
  return readSupportWorkspaceView({ db, ...ctx }, workspaceId);
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

// lifecycle: workspace export (#301)

/** Request an export (owners only, fresh step-up in `sessionId`, #304) and enqueue `export.build`. */
export async function requestExportFor(
  ctx: Omit<ExportRequestCtx, 'db'> & { sessionId: string },
  input: { scope: 'workspace' | 'user' },
): Promise<ExportJob> {
  const [{ requestExport }, { enqueue }] = await Promise.all([
    import('../lifecycle/index.ts'),
    import('../jobs/index.ts'),
  ]);
  return requestExport({ db, ...ctx }, input, {
    enqueue: (job) => enqueue('export.build', job),
  });
}

/** The requester's latest exports in the current workspace (at most 5), newest first. */
export async function listExportJobsFor(ctx: Omit<ExportRequestCtx, 'db'>): Promise<ExportJob[]> {
  const { listExportJobs } = await import('../lifecycle/index.ts');
  return listExportJobs({ db, ...ctx });
}

/** A signed download link for the requester's ready export (`NOT_FOUND` otherwise). */
export async function issueExportDownloadFor(
  ctx: Omit<ExportRequestCtx, 'db'>,
  jobId: string,
  options: { secret: string },
): Promise<ExportDownloadLink> {
  const { issueExportDownload } = await import('../lifecycle/index.ts');
  return issueExportDownload({ db, ...ctx }, jobId, options);
}

/** The requester's export as a decrypted stream, after the token and audit checks. */
export async function openExportDownloadFor(
  ctx: Omit<ExportRequestCtx, 'db'>,
  jobId: string,
  token: string,
  deps: ExportDownloadDeps,
): Promise<ExportDownload> {
  const { openExportDownload } = await import('../lifecycle/index.ts');
  return openExportDownload({ db, ...ctx }, jobId, token, deps);
}

// lifecycle: workspace deletion (#302, wired in #305)

/** Request deletion of the workspace (owners only, fresh step-up, typed name); owners are emailed. */
export async function requestWorkspaceDeletionFor(
  ctx: Omit<DeletionRequestCtx, 'db'>,
  input: { confirmName: string },
): Promise<DeletionJob> {
  const { requestWorkspaceDeletion } = await import('../lifecycle/index.ts');
  const { enqueueNotificationDelivery } = await import('../jobs/index.ts');
  return requestWorkspaceDeletion({ db, ...ctx }, input, {
    enqueueDelivery: (job) => enqueueNotificationDelivery(job),
  });
}

/** Cancel the workspace's pending deletion (owners only, fresh step-up); owners are emailed. */
export async function cancelWorkspaceDeletionFor(
  ctx: Omit<DeletionRequestCtx, 'db'>,
  jobId: string,
): Promise<DeletionJob> {
  const { cancelWorkspaceDeletion } = await import('../lifecycle/index.ts');
  const { enqueueNotificationDelivery } = await import('../jobs/index.ts');
  return cancelWorkspaceDeletion({ db, ...ctx }, jobId, {
    enqueueDelivery: (job) => enqueueNotificationDelivery(job),
  });
}

/** The workspace's deletion in progress, for the shell's cool-off banner (members only), or `null`. */
export async function activeWorkspaceDeletionIn(scope: RuntimeScope): Promise<DeletionJob | null> {
  const { getActiveWorkspaceDeletion } = await import('../lifecycle/index.ts');
  return getActiveWorkspaceDeletion({ db, ...scope });
}

// lifecycle: account deletion and memory erasure (#303)

/** Request the caller's account deletion (fresh step-up in `sessionId`, #304) and enqueue `account.delete`. */
export async function requestAccountDeletionFor(
  ctx: Omit<AccountDeletionCtx, 'db'>,
): Promise<AccountDeletionJob> {
  const { requestAccountDeletion } = await import('../lifecycle/index.ts');
  const { enqueue } = await import('../jobs/index.ts');
  return requestAccountDeletion(
    { db, ...ctx },
    {
      enqueue: (job) =>
        enqueue('account.delete', { workspaceId: null, ...job, fairnessKey: job.userId }),
    },
  );
}

/** Request the erasure of the workspace's memory (owners only) and enqueue `memory.erase`. */
export async function requestMemoryErasureFor(
  ctx: Omit<MemoryErasureCtx, 'db'>,
): Promise<MemoryErasureJob> {
  const { MEMORY_ERASE_PRIORITY, requestMemoryErasure } = await import('../lifecycle/index.ts');
  const { enqueue } = await import('../jobs/index.ts');
  return requestMemoryErasure(
    { db, ...ctx },
    { enqueue: (job) => enqueue('memory.erase', job, { priority: MEMORY_ERASE_PRIORITY }) },
  );
}

// court rosters (#434)

/** `bench.changed` goes nowhere until the court-day reminders (#64) subscribe. */
const noopCourtEvents: CourtEvents = { emit: () => undefined };

/**
 * Parse a finalized, not-infected PDF the member uploaded (`/api/uploads`) into the forum's roster
 * preview. Checks membership (`NOT_FOUND`, so a forged scope reads nothing) and `workspace.manage`
 * (`FORBIDDEN`); an unknown forum code or another workspace's blob is `NOT_FOUND`, an unreadable
 * PDF `VALIDATION`. Nothing is written.
 */
export async function previewRosterImportFor(
  ctx: RuntimeScope & { store: ObjectStore },
  input: { blobId: string; forumCode: string },
): Promise<RosterPreview> {
  const [{ getForum, previewRosterImport }, workspaces] = await Promise.all([
    import('../court/index.ts'),
    import('../workspaces/index.ts'),
  ]);
  const { workspaceId, userId } = ctx;
  const blobNotFound = () => workspaces.notFound('Upload not found');
  if (!isUuid(workspaceId) || !isUuid(userId) || !isUuid(input.blobId)) throw blobNotFound();
  const found = await inWorkspace({ workspaceId, userId }, async (tx) => {
    const role = await workspaces.memberRole(tx, userId, workspaceId);
    if (role === null || !isRole(role)) throw workspaces.notFound('Workspace not found');
    const settings = workspaces.toPolicySettings(await workspaces.getRoleSettings(tx, workspaceId));
    try {
      assertCan({ userId, workspaceId, role }, 'workspace.manage', undefined, { settings });
    } catch (error) {
      if (error instanceof ForbiddenError) {
        throw workspaces.forbidden('You cannot import a roster');
      }
      throw error;
    }
    const forum = await getForum(tx, workspaceId, input.forumCode.trim());
    const { blob } = schema;
    const [row] = await tx
      .select({ key: blob.key })
      .from(blob)
      .where(
        and(
          eq(blob.workspaceId, workspaceId),
          eq(blob.id, input.blobId),
          eq(blob.kind, 'document'),
          isNotNull(blob.finalizedAt),
          ne(blob.scanStatus, 'infected'),
          isNull(blob.encHeader),
        ),
      )
      .limit(1);
    if (row === undefined) throw blobNotFound();
    return { key: row.key, code: forum.code };
  });
  const { body } = await ctx.store.get(found.key as ObjectKey);
  try {
    return await previewRosterImport(body, found.code);
  } catch {
    throw workspaces.invalid('We could not read this PDF');
  }
}

/** What `confirmRosterImportFor` did: the roster, and the alerts detection created. */
export interface ConfirmedRoster {
  roster: RosterWithEntries;
  alerts: BenchChangeAlertRow[];
  /** `failed` when detection threw after the roster committed; it can be re-run. */
  detection: 'ok' | 'failed';
}

/**
 * Confirm a reviewed roster (`confirmRosterImport`, its own transaction), then run
 * `detectBenchChanges` for it with the job queue's delivery enqueue once the roster has committed.
 * `CONFLICT` when the forum has an active roster and `supersedeCurrent` is not set, so the lawyer
 * confirms superseding it first.
 */
export async function confirmRosterImportFor(
  actor: RuntimeScope,
  input: ConfirmRosterImportInput & { supersedeCurrent?: boolean },
): Promise<ConfirmedRoster> {
  const [{ confirmRosterImport, detectBenchChanges, listRosters }, workspaces, jobs] =
    await Promise.all([
      import('../court/index.ts'),
      import('../workspaces/index.ts'),
      import('../jobs/index.ts'),
    ]);
  const { supersedeCurrent, ...rest } = input;
  const { workspaceId, userId } = actor;
  // Only a member learns whether the forum has an active roster; anyone else gets the service's
  // own NOT_FOUND below, so the check is no oracle on another workspace's rosters.
  if (supersedeCurrent !== true && isUuid(workspaceId) && isUuid(userId) && isUuid(rest.forumId)) {
    const active = await inWorkspace({ workspaceId, userId }, async (tx) =>
      (await workspaces.memberRole(tx, userId, workspaceId)) === null
        ? []
        : listRosters(tx, workspaceId, { forumId: rest.forumId, status: 'active' }),
    );
    if (active.length > 0) {
      throw workspaces.conflict('This forum has an active roster: confirm superseding it');
    }
  }
  const roster = await confirmRosterImport(db, actor, rest);
  try {
    const alerts = await detectBenchChanges(
      db,
      actor,
      { rosterId: roster.roster.id },
      {
        events: noopCourtEvents,
        enqueueDelivery: (job) => jobs.enqueueNotificationDelivery(job),
      },
    );
    return { roster, alerts, detection: 'ok' };
  } catch {
    return { roster, alerts: [], detection: 'failed' };
  }
}

// automation activity feed and undo (#49)

/** The matter-graph deps the engine takes: the app db, and a port no subscriber listens on yet. */
function automationDeps() {
  return { db, events: { emit() {} } };
}

/** One page of the activity feed (filters, search, keyset cursor), redacted for what the user may read. */
export async function listActivitiesFor(scope: RuntimeScope, filters: ActivityFilters = {}) {
  const { listActivities } = await import('../automation/index.ts');
  return listActivities(automationDeps(), scope, filters);
}

/** One activity as the feed shows it, or `NOT_FOUND`. */
export async function getActivityDetailFor(scope: RuntimeScope, activityId: string) {
  const { getActivityDetail } = await import('../automation/index.ts');
  return getActivityDetail(automationDeps(), scope, { activityId });
}

/** Activities per local day in a range, for the feed's day headings and the `?day=` link. */
export async function countActivitiesByDayFor(
  scope: RuntimeScope,
  input: { from: Date; to: Date; timeZone?: string },
) {
  const { countByDay } = await import('../automation/index.ts');
  return countByDay(automationDeps(), scope, input);
}

/** What undoing one auto-applied action would remove (the cascade), and why it cannot, if so. */
export async function previewUndoFor(scope: RuntimeScope, activityId: string) {
  const { previewUndo } = await import('../automation/index.ts');
  return previewUndo(automationDeps(), scope, { activityId });
}

/** Undo one auto-applied action and what was derived from it (7-day window, `matter.write`). */
export async function undoActivityFor(scope: RuntimeScope, activityId: string) {
  const { undoActivity } = await import('../automation/index.ts');
  return undoActivity(automationDeps(), scope, { activityId });
}

/** Undo everything the system applied from one capture. */
export async function undoCaptureFor(scope: RuntimeScope, captureId: string) {
  const { undoCapture } = await import('../automation/index.ts');
  return undoCapture(automationDeps(), scope, { captureId });
}

/** Move what one capture produced to another matter ("Moved to wrong matter? Reassign"). */
export async function reassignCaptureFor(scope: RuntimeScope, captureId: string, matterId: string) {
  const { reassignCapture } = await import('../automation/index.ts');
  return reassignCapture(automationDeps(), scope, { captureId, matterId });
}

/** The audited activity export (owners: the workspace; everyone else: their own activity). */
export async function exportActivitiesFor(
  scope: RuntimeScope,
  input: { from?: Date; to?: Date; limit?: number } = {},
) {
  const { exportActivities } = await import('../automation/index.ts');
  return exportActivities(automationDeps(), scope, input);
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

/**
 * A capture context (#43) on the app database (or `ctx.db`, e.g. an action's transaction) for a checked member of `ctx.workspaceId`: the
 * config comes from `CAPTURE_*` env (`captureConfigFromEnv`) and `jobs` sends `capture.scan` and
 * `capture.process` through the job producer. Imports load on first call, one after the other.
 */
export async function captureContext(
  ctx: Omit<CaptureCtx, 'db' | 'jobs' | 'config'> & { db?: CaptureCtx['db'] },
): Promise<CaptureCtx> {
  const { captureConfigFromProcess } = await import('../capture/index.ts');
  const { enqueue } = await import('../jobs/index.ts');
  return {
    ...ctx,
    db: ctx.db ?? db,
    config: captureConfigFromProcess(),
    jobs: {
      scan: (payload) => enqueue('capture.scan', payload),
      process: (payload) => enqueue('capture.process', payload),
    },
  };
}

/**
 * The workspace and member an inbound intake address (#54) belongs to, or null for an unknown,
 * rotated or revoked one (the same answer, no oracle). Runs on the app database with no workspace
 * scope: the sender is not a member. The inbound webhook (#530) calls it before anything else.
 */
export async function resolveIntakeAddressFor(address: string) {
  const { resolveAddress } = await import('../email-intake/index.ts');
  return resolveAddress(db, address);
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
export async function startAppFlagListener(): Promise<FlagListener> {
  const { startFlagListener } = await import('@causedeck/flags');
  return startFlagListener(db);
}
