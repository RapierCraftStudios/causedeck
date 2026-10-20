// Cross-tenant `@causedeck/core/runtime` (#298): the app's database seam binds the app-role `db`,
// so here `db` is the test app database. User `ub`, owner of workspace B, calls every runtime
// service with workspace A's ids and must be denied (`denies`), see nothing of A's (`rls-empty`) or
// get a result scoped to itself (`self-scoped`). `caller-checked` loaders take a scope the web
// caller has already checked: the case shows B's scope reads only B and that the caller's gate
// (`memberRoleFor`) refuses A. The cases are driven by RUNTIME_SERVICE_TESTS, so a registered
// runtime service without a case here fails.
import { randomUUID } from 'node:crypto';

import { schema, withWorkspace } from '@causedeck/db';
import { closeTestDb, testAppDb } from '@causedeck/db/testing';
import { RUNTIME_SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@causedeck/db', async (original) => {
  const actual = await original<Record<string, unknown>>();
  const { testAppDb: appDb } = await import('@causedeck/db/testing');
  return { ...actual, db: appDb() };
});

const runtime = await import('../../runtime/index.ts');

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/runtime.test.ts';
const RANGE = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };

let t: TwoTenants;
let aInvitationToken: string;
let aInvoiceId: string;
let aExportId: string;
let aDeletionId: string;
const SECRET = 'xt-runtime-export-secret-0123456789abcdef';

/** Rejects with a NOT_FOUND or FORBIDDEN error (workspace, invitation or notification). */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND or FORBIDDEN').toBeInstanceOf(Error);
  expect(['NOT_FOUND', 'FORBIDDEN']).toContain((error as { code?: string }).code);
}

/** B's scope, as the web caller passes it after checking `ub` is a member of B. */
const asB = () => ({ workspaceId: t.b.id, userId: t.ub });
/** A's ids under `ub`: what a forged request would pass. */
const forged = () => ({ workspaceId: t.a.id, userId: t.ub });

/** A live session of `userId` with a fresh step-up (#304), so only the tenancy check can refuse. */
async function steppedUp(userId: string): Promise<string> {
  const [row] = await testAppDb()
    .insert(schema.session)
    .values({
      token: randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      stepUpAt: new Date(),
    })
    .returning({ id: schema.session.id });
  if (row === undefined) throw new Error('steppedUp: insert returned no row');
  return row.id;
}

async function aMemberIds(): Promise<string[]> {
  const rows = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, (s) =>
    s.select({ id: schema.member.id }).from(schema.member),
  );
  return rows.map((r) => r.id).sort();
}

async function aAuditIds(): Promise<string[]> {
  const rows = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, (s) =>
    s.select({ id: schema.auditEvent.id }).from(schema.auditEvent),
  );
  return rows.map((r) => r.id).sort();
}

/** A's deletion jobs as `id:status`, read as A's owner. */
async function aDeletionStatus(): Promise<string[]> {
  const rows = await withWorkspace(testAppDb(), { workspaceId: t.a.id }, (s) =>
    s
      .select({ id: schema.deletionJob.id, status: schema.deletionJob.status })
      .from(schema.deletionJob),
  );
  return rows.map((r) => `${r.id}:${r.status}`).sort();
}

/** The caller gate every scope-taking loader relies on: `ub` is not a member of A. */
async function expectCallerGateRefusesA(): Promise<void> {
  expect(await runtime.memberRoleFor(t.ub, t.a.id)).toBeNull();
}

const CASES: Record<string, () => Promise<void>> = {
  inWorkspace: async () => {
    const seen = await runtime.inWorkspace(asB(), (tx) =>
      tx.select({ id: schema.organization.id }).from(schema.organization),
    );
    expect(seen.map((r) => r.id)).toEqual([t.b.id]);
    await expectCallerGateRefusesA();
  },
  inWorkspaceOn: async () => {
    const seen = await runtime.inWorkspaceOn(testAppDb(), asB(), (tx) =>
      tx.select({ id: schema.organization.id }).from(schema.organization),
    );
    expect(seen.map((r) => r.id)).toEqual([t.b.id]);
    await expectCallerGateRefusesA();
  },
  memberRoleFor: async () => {
    expect(await runtime.memberRoleFor(t.ub, t.a.id)).toBeNull();
    expect(await runtime.memberRoleFor(t.ub, t.b.id)).toBe('owner');
  },
  ownerGraceFor: async () => {
    const before = await runtime.ownerGraceFor(t.ua, t.a.id);
    expect(before?.role).toBe('owner');
    // `ub` is not a member of A: no role and no grant time come back for A.
    expect(await runtime.ownerGraceFor(t.ub, t.a.id)).toBeNull();
    // Asking about A's owner under B's workspace id reveals nothing either.
    expect(await runtime.ownerGraceFor(t.ua, t.b.id)).toBeNull();
    expect((await runtime.ownerGraceFor(t.ub, t.b.id))?.role).toBe('owner');
    // A's grant is unchanged.
    expect(await runtime.ownerGraceFor(t.ua, t.a.id)).toEqual(before);
  },
  resolveSlugFor: async () => {
    // The slug resolves for anyone; the workspace loader refuses it because `ub` is not a member.
    const resolved = await runtime.resolveSlugFor(t.a.slug, t.ub);
    expect(resolved?.workspace.id).toBe(t.a.id);
    expect(await runtime.memberRoleFor(t.ub, t.a.id)).toBeNull();
  },
  listMembershipsFor: async () => {
    const ids = (await runtime.listMembershipsFor(t.ub)).map((m) => m.workspaceId);
    expect(ids).toContain(t.b.id);
    expect(ids).not.toContain(t.a.id);
  },
  createWorkspaceFor: async () => {
    const before = await aMemberIds();
    const created = await runtime.createWorkspaceFor({ userId: t.ub, input: { name: t.a.name } });
    expect(created.id).not.toBe(t.a.id);
    expect(created.slug).not.toBe(t.a.slug);
    expect(await aMemberIds()).toEqual(before);
    expect(await runtime.memberRoleFor(t.ub, t.a.id)).toBeNull();
  },
  previewInvitationFor: async () => {
    const preview = await runtime.previewInvitationFor({ userId: t.ub, token: aInvitationToken });
    expect(preview.state).toBe('EMAIL_MISMATCH');
    expect(JSON.stringify(preview)).not.toContain('@example.test');
  },
  acceptInvitationFor: async () => {
    const before = await aMemberIds();
    await expectDenied(runtime.acceptInvitationFor({ userId: t.ub, token: aInvitationToken }));
    expect(await aMemberIds()).toEqual(before);
    expect(await runtime.memberRoleFor(t.ub, t.a.id)).toBeNull();
  },
  loadMembersPage: async () => {
    const page = await runtime.loadMembersPage(asB());
    const aMembers = new Set(await aMemberIds());
    expect(page.members.length).toBeGreaterThan(0);
    expect(page.members.filter((m) => aMembers.has(m.memberId))).toEqual([]);
    expect(page.invitations.map((i) => i.id)).not.toContain(t.a.rows.invitation?.invitationId);
    // The seat summary counts B's active members only, never A's.
    expect(page.seats?.used.total).toBe(page.members.length);
    expect(page.seats?.granted.seats).toBeGreaterThanOrEqual(1);
    await expectCallerGateRefusesA();
  },
  listMembersIn: async () => {
    const aMembers = new Set(await aMemberIds());
    const members = await runtime.listMembersIn(asB());
    expect(members.length).toBeGreaterThan(0);
    expect(members.filter((m) => aMembers.has(m.memberId))).toEqual([]);
    await expectCallerGateRefusesA();
  },
  loadBillingPage: async () => {
    const page = await runtime.loadBillingPage(asB());
    expect(page.invoices.map((i) => i.id)).not.toContain(aInvoiceId);
    await expectCallerGateRefusesA();
  },
  loadUsagePage: async () => {
    const page = await runtime.loadUsagePage(asB(), new Date());
    expect(Object.keys(page.counters).length).toBeGreaterThan(0);
    await expectCallerGateRefusesA();
  },
  openInvoicePdf: async () => {
    // Never reaches the store or keys: A's invoice is not in B's workspace.
    const ctx = { ...asB(), store: {} as never, keys: {} as never };
    expect(await runtime.openInvoicePdf(ctx, aInvoiceId)).toBeNull();
  },
  authorizeAuditReadFor: async () => {
    await expectDenied(runtime.authorizeAuditReadFor(forged()));
  },
  queryAuditFeed: async () => {
    await expectDenied(runtime.queryAuditFeed(forged(), {}));
    const own = await runtime.queryAuditFeed(asB(), {});
    const aIds = new Set(await aAuditIds());
    expect(own.events.filter((e) => aIds.has(e.id))).toEqual([]);
  },
  verifyAuditRange: async () => {
    await expectDenied(runtime.verifyAuditRange(forged(), RANGE.from, RANGE.to));
  },
  exportAuditFor: async () => {
    const before = await aAuditIds();
    await expectDenied(runtime.exportAuditFor(forged(), { ...RANGE, format: 'jsonl' }));
    // A denied export records nothing in A's chain.
    expect(await aAuditIds()).toEqual(before);
  },
  recordAccessDeniedFor: async () => {
    const before = await aAuditIds();
    // guard reports `ub` as a non-member of A, so the denial goes to the global chain, not A's.
    await runtime.recordAccessDeniedFor({ workspaceId: t.a.id, member: false, actorUserId: t.ub });
    expect(await aAuditIds()).toEqual(before);
  },
  loadSupportPage: async () => {
    const page = await runtime.loadSupportPage(asB());
    expect(page.map((s) => s.workspaceId).filter((id) => id !== t.b.id)).toEqual([]);
    expect(page.map((s) => s.id)).not.toContain(t.a.rows.support_session?.id);
    await expectCallerGateRefusesA();
  },
  activeSupportSessionIn: async () => {
    const active = await runtime.activeSupportSessionIn(asB());
    expect(active === null || active.workspaceId === t.b.id).toBe(true);
    await expectCallerGateRefusesA();
  },
  requestSupportSessionFor: async () => {
    // ub is not staff: refused before a row or notification is written.
    await expectDenied(
      runtime.requestSupportSessionFor(
        { staffUserId: t.ub },
        { workspaceId: t.a.id, reason: 'Probe' },
      ),
    );
  },
  grantSupportSessionFor: async () => {
    const sessionId = t.a.rows.support_session?.id ?? '';
    await expectDenied(runtime.grantSupportSessionFor(forged(), { sessionId }));
    await expectDenied(runtime.grantSupportSessionFor(asB(), { sessionId }));
  },
  denySupportSessionFor: async () => {
    const sessionId = t.a.rows.support_session?.id ?? '';
    await expectDenied(runtime.denySupportSessionFor(forged(), { sessionId }));
    await expectDenied(runtime.denySupportSessionFor(asB(), { sessionId }));
  },
  revokeSupportSessionFor: async () => {
    const sessionId = t.a.rows.support_session?.id ?? '';
    await expectDenied(runtime.revokeSupportSessionFor(forged(), { sessionId }));
    await expectDenied(runtime.revokeSupportSessionFor(asB(), { sessionId }));
  },
  // the staff console (#314): ub is not staff, so nothing of A's is listed, opened or viewed
  listStaffSupportSessionsFor: async () => {
    expect(await runtime.listStaffSupportSessionsFor(t.ub)).toEqual([]);
  },
  staffSupportSessionFor: async () => {
    const sessionId = t.a.rows.support_session?.id ?? '';
    expect(await runtime.staffSupportSessionFor(t.ub, sessionId)).toBeNull();
  },
  supportWorkspaceViewFor: async () => {
    const before = await aAuditIds();
    await expectDenied(runtime.supportWorkspaceViewFor({ staffUserId: t.ub }, t.a.id));
    expect(await aAuditIds()).toEqual(before);
  },
  recordAccountProfileUpdatedFor: async () => {
    const before = await aAuditIds();
    // Account-level: `ua`'s own profile change never writes into workspace A's chain.
    await runtime.recordAccountProfileUpdatedFor(t.ua, ['name']);
    expect(await aAuditIds()).toEqual(before);
  },
  requestExportFor: async () => {
    const before = await aAuditIds();
    // Refused before anything is written or enqueued: ub is not an owner of A.
    await expectDenied(
      runtime.requestExportFor(
        { ...forged(), sessionId: await steppedUp(t.ub) },
        { scope: 'workspace' },
      ),
    );
    expect(await aAuditIds()).toEqual(before);
  },
  requestAccountDeletionFor: async () => {
    const before = { audit: await aAuditIds(), members: await aMemberIds() };
    // Acts on the caller's own account only: ub owns B alone, so it is refused, and A is unchanged.
    expect(
      await runtime
        .requestAccountDeletionFor({ userId: t.ub, sessionId: await steppedUp(t.ub) })
        .then(
          () => undefined,
          (e: unknown) => (e as { code?: string }).code,
        ),
    ).toBe('CONFLICT');
    expect({ audit: await aAuditIds(), members: await aMemberIds() }).toEqual(before);
  },
  requestMemoryErasureFor: async () => {
    const before = await aAuditIds();
    // Refused before anything is written or enqueued: ub is not an owner of A.
    await expectDenied(runtime.requestMemoryErasureFor(forged()));
    expect(await aAuditIds()).toEqual(before);
  },
  listExportJobsFor: async () => {
    // Forged: A's ids under ub see none of A's exports (A's export was requested by ua).
    expect(await runtime.listExportJobsFor(forged())).toEqual([]);
    expect((await runtime.listExportJobsFor(asB())).map((job) => job.id)).not.toContain(aExportId);
  },
  requestWorkspaceDeletionFor: async () => {
    const before = { audit: await aAuditIds(), deletion: await aDeletionStatus() };
    // Refused before anything is written or enqueued: ub is not an owner of A.
    await expectDenied(
      runtime.requestWorkspaceDeletionFor(
        { ...forged(), sessionId: await steppedUp(t.ub) },
        { confirmName: 'anything' },
      ),
    );
    expect({ audit: await aAuditIds(), deletion: await aDeletionStatus() }).toEqual(before);
  },
  cancelWorkspaceDeletionFor: async () => {
    const before = await aDeletionStatus();
    await expectDenied(
      runtime.cancelWorkspaceDeletionFor(
        { ...forged(), sessionId: await steppedUp(t.ub) },
        aDeletionId,
      ),
    );
    await expectDenied(
      runtime.cancelWorkspaceDeletionFor(
        { ...asB(), sessionId: await steppedUp(t.ub) },
        aDeletionId,
      ),
    );
    expect(await aDeletionStatus()).toEqual(before);
  },
  activeWorkspaceDeletionIn: async () => {
    // A non-member sees no banner for A, whatever A's deletion state.
    expect(await runtime.activeWorkspaceDeletionIn(forged())).toBeNull();
    await expectCallerGateRefusesA();
  },
  issueExportDownloadFor: async () => {
    await expectDenied(runtime.issueExportDownloadFor(forged(), aExportId, { secret: SECRET }));
    await expectDenied(runtime.issueExportDownloadFor(asB(), aExportId, { secret: SECRET }));
  },
  openExportDownloadFor: async () => {
    const deps = { store: {} as never, keys: {} as never, secret: SECRET };
    await expectDenied(runtime.openExportDownloadFor(forged(), aExportId, 'forged.token', deps));
    await expectDenied(runtime.openExportDownloadFor(asB(), aExportId, 'forged.token', deps));
  },
  loadNotificationPreferences: async () => {
    await expectDenied(runtime.loadNotificationPreferences(forged()));
    await expectDenied(runtime.loadNotificationPreferences({ workspaceId: t.b.id, userId: t.ua }));
  },
  subscribePush: async () => {
    const endpoint = `https://push.example.test/${randomUUID()}`;
    const keys = { p256dh: 'xt-p256dh', auth: 'xt-auth' };
    await runtime.subscribePush(t.ua, { endpoint, keys }, null);
    // Re-subscribing the endpoint as `ub` does not leave `ua` holding it.
    await runtime.subscribePush(t.ub, { endpoint, keys }, null);
    expect(await runtime.unsubscribePush(t.ua, endpoint)).toBe(false);
    expect(await runtime.unsubscribePush(t.ub, endpoint)).toBe(true);
  },
  unsubscribePush: async () => {
    const endpoint = `https://push.example.test/${randomUUID()}`;
    await runtime.subscribePush(t.ua, { endpoint, keys: { p256dh: 'p', auth: 'a' } }, null);
    expect(await runtime.unsubscribePush(t.ub, endpoint)).toBe(false);
    expect(await runtime.unsubscribePush(t.ua, endpoint)).toBe(true);
  },
  consumeRequestLimit: async () => {
    const limit = { max: 1, windowSeconds: 60 };
    const aKey = `xt:${t.ua}:${randomUUID()}`;
    const bKey = `xt:${t.ub}:${randomUUID()}`;
    expect(await runtime.consumeRequestLimit(aKey, limit)).toBe(true);
    expect(await runtime.consumeRequestLimit(aKey, limit)).toBe(false);
    expect(await runtime.consumeRequestLimit(bKey, limit)).toBe(true);
  },
  startAppFlagListener: async () => {
    const listener = await runtime.startAppFlagListener();
    expect(typeof listener.unlisten).toBe('function');
    await listener.unlisten();
  },
};

beforeAll(async () => {
  t = await seedTwoTenants(testAppDb());
  const token = t.a.rows.invitation?.token;
  const invoiceId = t.a.rows.saas_invoice?.invoiceId;
  const exportId = t.a.rows.export_job?.id;
  const deletionId = t.a.rows.deletion_job?.id;
  if (!token || !invoiceId || !exportId || !deletionId) throw new Error('seed rows');
  aDeletionId = deletionId;
  aExportId = exportId;
  aInvitationToken = token;
  aInvoiceId = invoiceId;
});

afterAll(closeTestDb);

describe('cross-tenant @causedeck/core/runtime', () => {
  const registered = Object.entries(RUNTIME_SERVICE_TESTS).filter(
    ([, entry]) => entry.test === THIS_FILE,
  );

  it('has a case for every runtime service registered here, and none extra', () => {
    expect(registered.length).toBeGreaterThan(10);
    expect(Object.keys(CASES).sort()).toEqual(registered.map(([name]) => name).sort());
  });

  it.each(registered)('%s keeps workspace A out of reach of user B', async (name) => {
    const run = CASES[name];
    if (!run) throw new Error(`no case for ${name}`);
    await run();
  });
});
