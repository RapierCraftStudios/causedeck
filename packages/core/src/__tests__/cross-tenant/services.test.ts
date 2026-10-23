// Cross-tenant core services (#19, #209): user `ub`, working in workspace B, calls every exported
// `@causedeck/core` service with workspace A's ids and must get NOT_FOUND or FORBIDDEN (`denies`),
// nothing of A's (`rls-empty`), or a result scoped to itself (`self-scoped`). `caller-checked`
// services are covered through the caller that checks. A's rows must be unchanged afterwards.
// The cases are driven by the registry in `@causedeck/db/testing/cross-tenant-registry`, so a
// registered service without a case here fails.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import type { Mailer } from '@causedeck/auth/mailer';
import { schema, TenancyError, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { createLogger } from '@causedeck/observability';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as core from '../../index.ts';

const THIS_FILE = 'packages/core/src/__tests__/cross-tenant/services.test.ts';
const mailer: Mailer = { send: () => Promise.resolve() };
const APP_URL = 'http://localhost:3000';
const send = { mailer, appUrl: APP_URL };
const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

interface Fixture extends TwoTenants {
  tx: Transaction;
  /** Run `fn` as `ub` inside workspace B's scope. */
  asB: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
  /** A's viewer member (seed row) and A's pending invitation. */
  aMember: { memberId: string; userId: string };
  aInvitation: { invitationId: string; token: string };
}

/** Rejects with a WorkspaceError whose code is NOT_FOUND or FORBIDDEN. */
async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND or FORBIDDEN').toBeInstanceOf(core.WorkspaceError);
  expect(['NOT_FOUND', 'FORBIDDEN']).toContain((error as core.WorkspaceError).code);
}

async function aWorkspaceRow(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s.select().from(schema.organization).where(eq(schema.organization.id, f.a.id)),
  );
}

async function aMembers(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s
      .select({ id: schema.member.id, role: schema.member.role, status: schema.member.status })
      .from(schema.member)
      .orderBy(schema.member.id),
  );
}

async function aInvitations(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s
      .select({
        id: schema.invitation.id,
        tokenHash: schema.invitation.tokenHash,
        revokedAt: schema.invitation.revokedAt,
      })
      .from(schema.invitation),
  );
}

async function aSupportSessions(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s.select().from(schema.supportSession).orderBy(schema.supportSession.id),
  );
}

async function aForums(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s
      .select({ id: schema.forum.id, code: schema.forum.code, court: schema.forum.court })
      .from(schema.forum)
      .where(eq(schema.forum.workspaceId, f.a.id))
      .orderBy(schema.forum.id),
  );
}

/** A later parse run of A's on the two-tenant echo forum, naming a hall only A has. */
async function aProbeRun(f: Fixture) {
  const documentId = f.a.rows.adapter_parse_run?.documentId ?? '';
  const [row] = await inWorkspace(f.tx, f.a.id, (s) =>
    s
      .insert(schema.adapterParseRun)
      .values({
        workspaceId: f.a.id,
        documentId,
        adapterId: 'echo',
        adapterVersion: '1.0.0',
        forumCode: 'test.echo.principal',
        rowsParsed: 9,
        rowsAnchored: 7,
        unmappedHeadings: 0,
        unknownCaseTypes: 0,
        hallsSeen: ['xt-a-hall'],
        hallsUnreadable: ['xt-a-hall'],
        status: 'degraded',
        createdAt: new Date(Date.now() + 60_000),
      })
      .returning(),
  );
  if (row === undefined) throw new Error('probe parse run not inserted');
  return { run: row, before: await aParseRuns(f), forums: await aForums(f) };
}

async function aParseRuns(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s.select().from(schema.adapterParseRun).orderBy(schema.adapterParseRun.id),
  );
}

async function aRestrictions(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s.select().from(schema.matterRestriction).orderBy(schema.matterRestriction.id),
  );
}

/**
 * A workspace's matter-graph rows (A's unless `workspaceId`), for before/after checks: one key per
 * table the services write (matters.ts, proceedings.ts and its links, documents.ts, state-machine.ts,
 * which writes state history, next-date.ts, which writes listings, merge-split.ts, which also
 * moves orders, obligations, tasks and edges, and people.ts, which writes persons and edges;
 * read-models.ts writes nothing).
 */
async function aGraph(f: Fixture, workspaceId = f.a.id) {
  return inWorkspace(f.tx, workspaceId, async (s) => ({
    matters: await s.select().from(schema.matter).orderBy(schema.matter.id),
    proceedings: await s.select().from(schema.proceeding).orderBy(schema.proceeding.id),
    links: await s.select().from(schema.proceedingLink).orderBy(schema.proceedingLink.id),
    stateChanges: await s
      .select()
      .from(schema.proceedingStateChange)
      .orderBy(schema.proceedingStateChange.id),
    documents: await s.select().from(schema.document).orderBy(schema.document.id),
    listings: await s.select().from(schema.listing).orderBy(schema.listing.id),
    orders: await s.select().from(schema.order).orderBy(schema.order.id),
    obligations: await s.select().from(schema.obligation).orderBy(schema.obligation.id),
    tasks: await s.select().from(schema.task).orderBy(schema.task.id),
    roleEdges: await s.select().from(schema.roleEdge).orderBy(schema.roleEdge.id),
    persons: await s.select().from(schema.person).orderBy(schema.person.id),
  }));
}

/** The matter of A's seeded proceeding (a second matter of A, besides the seeded one). */
async function aProceedingMatter(f: Fixture): Promise<string> {
  const proceedingId = f.a.rows.proceeding?.proceedingId ?? '';
  const [row] = await inWorkspace(f.tx, f.a.id, (s) =>
    s
      .select({ matterId: schema.proceeding.matterId })
      .from(schema.proceeding)
      .where(eq(schema.proceeding.id, proceedingId)),
  );
  return row?.matterId ?? '';
}

const AT = '2026-01-01 00:00:00+00';
const none = { proceeding: [], obligation: [], task: [] };

/** Runs a mixed call (one id of B, one of A) as ub in B: CrossWorkspaceError, B unchanged. */
async function expectCrossWorkspace(f: Fixture, call: () => Promise<unknown>): Promise<void> {
  const before = await aGraph(f, f.b.id);
  await expect(call()).rejects.toBeInstanceOf(core.CrossWorkspaceError);
  expect(await aGraph(f, f.b.id)).toEqual(before);
}

/** Matter-graph deps that record every emitted event. */
function graphDeps(db: Database | Transaction) {
  const events: core.GraphEvent[] = [];
  return { deps: { db, events: { emit: (e: core.GraphEvent) => events.push(e) } }, events };
}

/** Runs `call` as ub claiming A (no scope and from B's scope) and as ub in B with A's ids. */
async function expectGraphDenied(
  f: Fixture,
  call: (db: Database | Transaction, workspaceId: string) => Promise<unknown>,
): Promise<void> {
  const before = await aGraph(f);
  await expectDenied(call(f.tx, f.a.id));
  await expectDenied(f.asB((s) => call(s, f.a.id)));
  await expectDenied(call(f.tx, f.b.id));
  expect(await aGraph(f)).toEqual(before);
}

const PROBE_PROVENANCE = { sourceType: 'manual' } as const;

/** A's seeded listing (canonical) and its proceeding. */
async function aListing(f: Fixture): Promise<{ listingId: string; proceedingId: string }> {
  const listingId = f.a.rows.listing?.listingId ?? '';
  const [row] = await inWorkspace(f.tx, f.a.id, (s) =>
    s
      .select({ proceedingId: schema.listing.proceedingId })
      .from(schema.listing)
      .where(eq(schema.listing.id, listingId)),
  );
  if (!row) throw new Error("A's listing not found");
  return { listingId, proceedingId: row.proceedingId };
}

async function aWorkspace(f: Fixture) {
  const [row] = await inWorkspace(f.tx, f.a.id, (s) =>
    s.select().from(schema.organization).where(eq(schema.organization.id, f.a.id)),
  );
  return row;
}

/** A's usage counters and ledger. */
async function aUsage(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    counters: await s
      .select({ key: schema.usageCounter.key, value: schema.usageCounter.value })
      .from(schema.usageCounter)
      .orderBy(schema.usageCounter.key),
    events: await s
      .select({ id: schema.usageEvent.id, amount: schema.usageEvent.amount })
      .from(schema.usageEvent)
      .orderBy(schema.usageEvent.id),
  }));
}

async function sessionFor(tx: Transaction, userId: string, workspaceId: string): Promise<string> {
  const [row] = await tx
    .insert(schema.session)
    .values({
      userId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 86_400_000),
      activeOrganizationId: workspaceId,
    })
    .returning({ id: schema.session.id });
  if (!row) throw new Error('session insert failed');
  return row.id;
}

/** A workspace job that records which workspaces' `job_effect` rows its handler can see. */
function probeJob(seen: string[][]) {
  return core.defineJob({
    name: 'xt.seed',
    schema: z.object({ workspaceId: z.uuid() }),
    handler: async (ctx) => {
      const rows = await ctx.db.select({ ws: schema.jobEffect.workspaceId }).from(schema.jobEffect);
      seen.push([...new Set(rows.map((r) => r.ws))]);
      const claimed = await core.once(ctx, 'xt-a-key', () => Promise.resolve('ran'));
      seen.push([claimed.skipped ? 'skipped' : 'ran']);
    },
  });
}

async function runProbe(f: Fixture, workspaceId: string) {
  const seen: string[][] = [];
  const outcome = await core.runJob(
    probeJob(seen),
    { id: randomUUID(), data: { workspaceId }, retryCount: 0 },
    { db: f.tx as unknown as Database, logger },
  );
  return { outcome, seen };
}

type Case = (f: Fixture) => Promise<void>;

// The seeded reservation expires 5 minutes after the real clock, so the usage clock is the real one.
const USAGE_NOW = new Date();

/** A request's owner email deliveries; never reached when the request is refused. */
const enqueueDelivery = () => Promise.resolve();
const aCtx = (f: Fixture) => ({ db: f.tx, workspaceId: f.a.id, now: () => USAGE_NOW });
const bCtx = (f: Fixture) => ({ db: f.tx, workspaceId: f.b.id, now: () => USAGE_NOW });

/** A's reservations, budget overrides, audit trail and usage counters. */
async function aBudgetState(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    reservations: await s
      .select({ id: schema.usageReservation.id, amount: schema.usageReservation.amountPaise })
      .from(schema.usageReservation)
      .orderBy(schema.usageReservation.id),
    overrides: await s
      .select({ id: schema.budgetOverride.id, limit: schema.budgetOverride.limitValue })
      .from(schema.budgetOverride)
      .orderBy(schema.budgetOverride.id),
    audit: await s.select({ id: schema.auditEvent.id }).from(schema.auditEvent),
    usage: await s
      .select({ key: schema.usageCounter.key, value: schema.usageCounter.value })
      .from(schema.usageCounter),
  }));
}

/** Gives A a 100_000 paise override so A can reserve without plan seeding. */
async function budgetA(f: Fixture) {
  await core.setBudgetOverride(aCtx(f), {
    limitPaise: 100_000,
    reason: 'xt fixture',
    expiresAt: new Date(USAGE_NOW.getTime() + 86_400_000),
    staffUserId: f.ua,
  });
}

/** Rejects with TENANCY_VIOLATION: B's scope cannot be switched to A's workspace. */
async function expectTenancyViolation(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect((error as { code?: string } | undefined)?.code).toBe('TENANCY_VIOLATION');
}

async function auditIds(f: Fixture, workspaceId: string): Promise<string[]> {
  const rows = await inWorkspace(f.tx, workspaceId, (s) =>
    s.select({ id: schema.auditEvent.id }).from(schema.auditEvent),
  );
  return rows.map((r) => r.id).sort();
}

const aiCallInput: core.AiCallInput = {
  purpose: 'xt.probe',
  provider: 'mock',
  model: 'mock-1',
  region: 'ap-south-1',
  inputTokens: 1,
  outputTokens: 1,
  costPaise: 0,
  automationLevel: 1,
};

/** A recording email transport for the notification jobs. */
function recordingDeps() {
  const sent: { to: string; subject: string }[] = [];
  const deps: core.NotificationJobDeps = {
    appUrl: APP_URL,
    // 13:00Z is 18:30 in Asia/Kolkata.
    now: () => new Date('2026-10-19T13:00:00Z'),
    email: {
      provider: 'console',
      send: (message) => {
        sent.push({ to: message.to, subject: message.subject });
        return Promise.resolve({});
      },
    },
  };
  return { sent, deps };
}

async function emailOf(f: Fixture, userId: string): Promise<string> {
  const [row] = await f.tx
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!row) throw new Error('user missing');
  return row.email;
}

const CASES: Record<string, Case> = {
  record: async (f) => {
    const before = await auditIds(f, f.a.id);
    await expectTenancyViolation(
      f.asB((s) =>
        core.record(
          { db: s, workspaceId: f.a.id, actor: { userId: f.ub, kind: 'user' } },
          { action: 'workspace.settings_viewed' },
        ),
      ),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordRoleChanged: async (f) => {
    const before = await auditIds(f, f.a.id);
    await expectTenancyViolation(
      f.asB((s) =>
        core.recordRoleChanged(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          targetUserId: f.ua,
          memberId: f.aMember.memberId,
          fromRole: 'viewer',
          toRole: 'owner',
        }),
      ),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordAccessDenied: async (f) => {
    const before = await auditIds(f, f.a.id);
    // The write into A's chain fails from B's scope and is swallowed, never landing in A.
    await f.asB((s) =>
      core.recordAccessDenied(s as unknown as Database, {
        workspaceId: f.a.id,
        member: true,
        actorUserId: f.ub,
      }),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordFlagChanged: async (f) => {
    const before = await auditIds(f, f.a.id);
    await expectTenancyViolation(
      f.asB((s) =>
        core.recordFlagChanged(s, {
          actorUserId: f.ub,
          key: 'xt.flag',
          workspaceId: f.a.id,
          oldValue: false,
          newValue: true,
          legalAck: false,
        }),
      ),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordExportRun: async (f) => {
    const before = await auditIds(f, f.a.id);
    await expectTenancyViolation(
      f.asB((s) =>
        core.recordExportRun(
          { db: s, workspaceId: f.a.id, actor: { userId: f.ub, kind: 'user' } },
          { format: 'csv', from: '2026-01-01', to: '2026-01-31' },
        ),
      ),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordSupportSessionStarted: async (f) => {
    const before = await auditIds(f, f.a.id);
    await expectTenancyViolation(
      f.asB((s) =>
        core.recordSupportSessionStarted(
          { db: s },
          { supportSessionId: randomUUID(), staffUserId: f.ub, workspaceId: f.a.id },
        ),
      ),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordSupportView: async (f) => {
    const before = await auditIds(f, f.a.id);
    await expectTenancyViolation(
      f.asB((s) =>
        core.recordSupportView(
          { db: s },
          {
            supportSessionId: randomUUID(),
            staffUserId: f.ub,
            workspaceId: f.a.id,
            targets: [{ kind: 'matter', id: randomUUID() }],
            action: 'matter.read',
          },
        ),
      ),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordSupportSessionEnded: async (f) => {
    const before = await auditIds(f, f.a.id);
    await expectTenancyViolation(
      f.asB((s) =>
        core.recordSupportSessionEnded(
          { db: s },
          { supportSessionId: randomUUID(), staffUserId: f.ub, workspaceId: f.a.id },
        ),
      ),
    );
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  verifyChain: async (f) => {
    await expectTenancyViolation(f.asB((s) => core.verifyChain(s, f.a.id)));
    // B's own chain holds only B's seed event, never A's.
    const own = await f.asB((s) => core.verifyChain(s, f.b.id));
    expect(own).toEqual({ ok: true, checked: (await auditIds(f, f.b.id)).length });
  },
  authorizeAuditRead: async (f) => {
    await expectTenancyViolation(
      f.asB((s) => core.authorizeAuditRead({ db: s, workspaceId: f.a.id, userId: f.ub })),
    );
    // ub is not a member of A: denied even outside B's scope.
    await expectDenied(core.authorizeAuditRead({ db: f.tx, workspaceId: f.a.id, userId: f.ub }));
  },
  queryAudit: async (f) => {
    await expectTenancyViolation(
      f.asB((s) => core.queryAudit({ db: s, workspaceId: f.a.id, userId: f.ub })),
    );
    await expectDenied(core.queryAudit({ db: f.tx, workspaceId: f.a.id, userId: f.ub }));
    // B's feed holds only B's events.
    const own = await core.queryAudit({ db: f.tx, workspaceId: f.b.id, userId: f.ub });
    expect(own.events.map((e) => e.id).sort()).toEqual(await auditIds(f, f.b.id));
  },
  exportAudit: async (f) => {
    const before = await auditIds(f, f.a.id);
    const range = { from: new Date(0), to: new Date(Date.now() + 86_400_000) };
    await expectTenancyViolation(
      f.asB((s) =>
        core.exportAudit(
          { db: s, workspaceId: f.a.id, userId: f.ub },
          { ...range, format: 'jsonl' },
        ),
      ),
    );
    await expectDenied(
      core.exportAudit(
        { db: f.tx, workspaceId: f.a.id, userId: f.ub },
        { ...range, format: 'csv' },
      ),
    );
    // No export event (or anything else) was written to A.
    expect(await auditIds(f, f.a.id)).toEqual(before);
  },
  recordAiCall: async (f) => {
    const count = () =>
      inWorkspace(f.tx, f.a.id, (s) => s.select({ id: schema.aiCall.id }).from(schema.aiCall));
    const before = await count();
    await expectTenancyViolation(f.asB((s) => core.recordAiCall(s, f.a.id, aiCallInput)));
    expect(await count()).toEqual(before);
  },
  listMemberships: async (f) => {
    const mine = await core.listMemberships(f.tx, f.ub);
    expect(mine.map((m) => m.workspaceId)).toEqual([f.b.id]);
    const inB = await f.asB((s) => core.listMemberships(s, f.ub));
    expect(inB.map((m) => m.workspaceId)).not.toContain(f.a.id);
  },
  listWorkspacesForUser: async (f) => {
    const page = await core.listWorkspacesForUser(f.tx, f.ub, { limit: 50 });
    expect(page.data.map((w) => w.id)).toEqual([f.b.id]);
  },
  memberRole: async (f) => {
    expect(await core.memberRole(f.tx, f.ub, f.a.id)).toBeNull();
    expect(await f.asB((s) => core.memberRole(s, f.ub, f.a.id))).toBeNull();
    // Even asking about A's owner from B's scope reveals nothing.
    expect(await f.asB((s) => core.memberRole(s, f.ua, f.a.id))).toBeNull();
  },
  ownerGrace: async (f) => {
    const before = await core.ownerGrace(f.tx, f.ua, f.a.id);
    expect(before?.role).toBe('owner');
    // B's member asks about A: nothing, from the plain scope and from B's scope.
    expect(await core.ownerGrace(f.tx, f.ub, f.a.id)).toBeNull();
    expect(await f.asB((s) => core.ownerGrace(s, f.ub, f.a.id))).toBeNull();
    // Even asking about A's owner from B's scope reveals neither role nor grant time.
    expect(await f.asB((s) => core.ownerGrace(s, f.ua, f.a.id))).toBeNull();
    // A is unchanged by the attempts.
    expect(await core.ownerGrace(f.tx, f.ua, f.a.id)).toEqual(before);
  },
  requireOwner: async (f) => {
    await expectDenied(f.asB((s) => core.requireOwner(s, f.a.id, f.ub)));
    await expectDenied(f.asB((s) => core.requireOwner(s, f.a.id, f.ua)));
  },
  requireCan: async (f) => {
    await expectDenied(f.asB((s) => core.requireCan(s, f.a.id, f.ub, 'matter.read')));
    await expectDenied(f.asB((s) => core.requireCan(s, f.a.id, f.ua, 'workspace.delete')));
  },
  listMembers: async (f) => {
    expect(await f.asB((s) => core.listMembers(s, f.a.id))).toEqual([]);
  },
  changeRole: async (f) => {
    const before = await aMembers(f);
    for (const actorUserId of [f.ub, f.ua]) {
      await expectDenied(
        f.asB((s) =>
          core.changeRole(s, {
            workspaceId: f.a.id,
            actorUserId,
            memberId: f.aMember.memberId,
            role: 'owner',
          }),
        ),
      );
    }
    // B's own workspace with A's member id.
    await expectDenied(
      f.asB((s) =>
        core.changeRole(s, {
          workspaceId: f.b.id,
          actorUserId: f.ub,
          memberId: f.aMember.memberId,
          role: 'owner',
        }),
      ),
    );
    expect(await aMembers(f)).toEqual(before);
  },
  removeMember: async (f) => {
    const before = await aMembers(f);
    const sessionId = await sessionFor(f.tx, f.aMember.userId, f.a.id);
    for (const workspaceId of [f.a.id, f.b.id]) {
      await expectDenied(
        f.asB((s) =>
          core.removeMember(s, { workspaceId, actorUserId: f.ub, memberId: f.aMember.memberId }),
        ),
      );
    }
    expect(await aMembers(f)).toEqual(before);
    const [still] = await f.tx
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId));
    expect(still?.id).toBe(sessionId);
  },
  prepareOwnershipTransfer: async (f) => {
    await expectDenied(
      f.asB((s) =>
        core.prepareOwnershipTransfer(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          newOwnerUserId: f.ub,
        }),
      ),
    );
    // B's owner cannot pull A's owner (not a member of B) into a transfer.
    await expectDenied(
      f.asB((s) =>
        core.prepareOwnershipTransfer(s, {
          workspaceId: f.b.id,
          actorUserId: f.ub,
          newOwnerUserId: f.ua,
        }),
      ),
    );
  },
  transferOwnership: async (f) => {
    const before = await aMembers(f);
    await expectDenied(
      f.asB((s) =>
        core.transferOwnership(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          newOwnerUserId: f.ub,
          confirmation: f.a.slug,
        }),
      ),
    );
    expect(await aMembers(f)).toEqual(before);
  },
  countBillableSeats: async (f) => {
    const seats = await f.asB((s) => core.countBillableSeats(s, f.a.id));
    expect(seats.total).toBe(0);
  },
  countOpenWork: async (f) => {
    const unregister = core.registerReassignProvider({
      name: 'xt-members',
      countOpen: async (tx, workspaceId) => {
        const rows = await tx
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(eq(schema.member.organizationId, workspaceId));
        return rows.length;
      },
      reassign: () => Promise.resolve(),
    });
    try {
      expect(await f.asB((s) => core.countOpenWork(s, f.a.id, f.ua))).toBe(0);
    } finally {
      unregister();
    }
  },
  offboardMember: async (f) => {
    const before = await aMembers(f);
    const sessionId = await sessionFor(f.tx, f.aMember.userId, f.a.id);
    const writes: unknown[] = [];
    core.setAuditSink({
      write: (_tx, event) => {
        writes.push(event);
        return Promise.resolve();
      },
    });
    for (const workspaceId of [f.a.id, f.b.id]) {
      await expectDenied(
        f.asB((s) =>
          core.offboardMember(s, {
            workspaceId,
            actorUserId: f.ub,
            target: { memberId: f.aMember.memberId, userId: f.aMember.userId },
          }),
        ),
      );
    }
    // Nothing of A's changed: the member's A session (a global table) survives, no audit event.
    const [still] = await f.tx
      .select({ id: schema.session.id })
      .from(schema.session)
      .where(eq(schema.session.id, sessionId));
    expect(still?.id).toBe(sessionId);
    expect(writes).toEqual([]);
    expect(await aMembers(f)).toEqual(before);
  },
  inviteMember: async (f) => {
    const before = await aInvitations(f);
    await expectDenied(
      f.asB((s) =>
        core.inviteMember(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          input: { email: `${randomUUID()}@example.test`, role: 'junior' },
          ...send,
        }),
      ),
    );
    expect(await aInvitations(f)).toEqual(before);
  },
  reissueInvitation: async (f) => {
    const before = await aInvitations(f);
    for (const workspaceId of [f.a.id, f.b.id]) {
      await expectDenied(
        f.asB((s) =>
          core.reissueInvitation(s, {
            workspaceId,
            actorUserId: f.ub,
            invitationId: f.aInvitation.invitationId,
            ...send,
          }),
        ),
      );
    }
    expect(await aInvitations(f)).toEqual(before);
  },
  revokeInvitation: async (f) => {
    const before = await aInvitations(f);
    for (const workspaceId of [f.a.id, f.b.id]) {
      await expectDenied(
        f.asB((s) =>
          core.revokeInvitation(s, {
            workspaceId,
            actorUserId: f.ub,
            invitationId: f.aInvitation.invitationId,
          }),
        ),
      );
    }
    expect(await aInvitations(f)).toEqual(before);
  },
  listPendingInvitations: async (f) => {
    expect(await f.asB((s) => core.listPendingInvitations(s, f.a.id))).toEqual([]);
  },
  getWorkspaceProfile: async (f) => {
    expect(await f.asB((s) => core.getWorkspaceProfile(s, f.a.id))).toBeNull();
  },
  updateWorkspaceProfile: async (f) => {
    const before = await core.getWorkspaceProfile(f.tx, f.a.id);
    await expectDenied(
      f.asB((s) =>
        core.updateWorkspaceProfile(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          input: {
            name: 'Cross-tenant probe',
            kind: 'chamber',
            timezone: 'Asia/Kolkata',
            locale: 'en',
            practiceCity: 'Probe City',
          },
        }),
      ),
    );
    expect(await core.getWorkspaceProfile(f.tx, f.a.id)).toEqual(before);
  },
  getRoleSettings: async (f) => {
    await f.tx
      .update(schema.workspaceSettings)
      .set({ advocatesCanInvite: false, ownersSeeRestricted: false })
      .where(eq(schema.workspaceSettings.workspaceId, f.a.id));
    // Under B's scope A's settings row is invisible: B reads the defaults, not A's values.
    expect(await f.asB((s) => core.getRoleSettings(s, f.a.id))).toEqual(core.DEFAULT_ROLE_SETTINGS);
  },
  updateRoleSettings: async (f) => {
    const before = await core.getRoleSettings(f.tx, f.a.id);
    await expectDenied(
      f.asB((s) =>
        core.updateRoleSettings(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          input: { advocatesCanInvite: false, ownersSeeRestrictedMatters: false },
        }),
      ),
    );
    expect(await core.getRoleSettings(f.tx, f.a.id)).toEqual(before);
  },
  getPrivacySettings: async (f) => {
    await f.tx
      .update(schema.workspaceSettings)
      .set({ sensitiveDefaultRestricted: false, retentionAudioDays: 7 })
      .where(eq(schema.workspaceSettings.workspaceId, f.a.id));
    // Under B's scope A's settings row is invisible: B reads the defaults, not A's values.
    expect(await f.asB((s) => core.getPrivacySettings(s, f.a.id))).toEqual(
      core.DEFAULT_PRIVACY_SETTINGS,
    );
  },
  updateWorkspacePrivacy: async (f) => {
    const before = await core.getPrivacySettings(f.tx, f.a.id);
    await expectDenied(
      f.asB((s) =>
        core.updateWorkspacePrivacy(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          input: { sensitiveDefaultRestricted: false, retentionAudioDays: 7 },
        }),
      ),
    );
    expect(await core.getPrivacySettings(f.tx, f.a.id)).toEqual(before);
  },
  getIntegrations: async (f) => {
    // A has a seeded ics_feed token; under B's scope it is invisible, so every kind reads as none.
    const ofA = await inWorkspace(f.tx, f.a.id, (s) => core.getIntegrations(s, f.a.id));
    expect(ofA.ics_feed).not.toBeNull();
    expect(await f.asB((s) => core.getIntegrations(s, f.a.id))).toEqual({
      ics_feed: null,
    });
  },
  rotateIntegrationToken: async (f) => {
    const hashesOfA = () =>
      inWorkspace(f.tx, f.a.id, (s) =>
        s
          .select({
            kind: schema.workspaceIntegration.kind,
            hash: schema.workspaceIntegration.tokenHash,
          })
          .from(schema.workspaceIntegration)
          .where(eq(schema.workspaceIntegration.workspaceId, f.a.id)),
      );
    const before = await hashesOfA();
    expect(before).toHaveLength(1);
    await expectDenied(
      f.asB((s) =>
        core.rotateIntegrationToken(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          kind: 'ics_feed',
        }),
      ),
    );
    expect(await hashesOfA()).toEqual(before);
  },
  acceptInvitation: async (f) => {
    const error: unknown = await core
      .acceptInvitation(f.tx, { userId: f.ub, token: f.aInvitation.token })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(core.InvitationError);
    expect((error as core.InvitationError).reason).toBe('EMAIL_MISMATCH');
    expect((error as core.InvitationError).code).toBe('FORBIDDEN');
    expect(await core.memberRole(f.tx, f.ub, f.a.id)).toBeNull();
  },
  previewInvitation: async (f) => {
    const preview = await core.previewInvitation(f.tx, {
      userId: f.ub,
      token: f.aInvitation.token,
    });
    expect(preview.state).toBe('EMAIL_MISMATCH');
    expect(JSON.stringify(preview)).not.toContain('@example.test');
    expect(await core.previewInvitation(f.tx, { userId: f.ub, token: randomUUID() })).toEqual({
      state: 'INVALID',
    });
  },
  generateUniqueSlug: async (f) => {
    const slug = await f.asB((s) => core.generateUniqueSlug(s, f.a.slug));
    expect(slug).not.toBe(f.a.slug);
  },
  renameSlug: async (f) => {
    await expectDenied(
      f.asB((s) =>
        core.renameSlug(s, { workspaceId: f.a.id, actorUserId: f.ub, newSlug: 'xt-hijack' }),
      ),
    );
    // B cannot take A's current slug or A's redirect slug either.
    const historySlug = f.a.rows.workspace_slug_history?.slug ?? '';
    for (const newSlug of [f.a.slug, historySlug]) {
      const error: unknown = await f
        .asB((s) => core.renameSlug(s, { workspaceId: f.b.id, actorUserId: f.ub, newSlug }))
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect((error as core.WorkspaceError).code).toBe('CONFLICT');
    }
    expect((await aWorkspace(f))?.slug).toBe(f.a.slug);
  },
  resolveSlug: () => Promise.resolve(),
  createWorkspace: async (f) => {
    const before = await aMembers(f);
    const created = await core.createWorkspace(f.tx, { userId: f.ub, input: { name: f.a.name } });
    expect(created.id).not.toBe(f.a.id);
    expect(created.slug).not.toBe(f.a.slug);
    expect(await aMembers(f)).toEqual(before);
    expect(await core.memberRole(f.tx, f.ub, f.a.id)).toBeNull();
  },
  softDeleteWorkspace: async (f) => {
    await expectDenied(
      f.asB((s) => core.softDeleteWorkspace(s, { workspaceId: f.a.id, actorUserId: f.ub })),
    );
    expect((await aWorkspace(f))?.deletedAt).toBeNull();
  },
  entitlements: async (f) => {
    // The seat gate trusts its callers; invite must refuse B before consulting it for A.
    const asked: string[] = [];
    core.setEntitlements({
      assertCanAddSeat: (_db, workspaceId) => {
        asked.push(workspaceId);
        return Promise.resolve();
      },
    });
    await expectDenied(
      f.asB((s) =>
        core.inviteMember(s, {
          workspaceId: f.a.id,
          actorUserId: f.ub,
          input: { email: `${randomUUID()}@example.test`, role: 'junior' },
          ...send,
        }),
      ),
    );
    await core
      .acceptInvitation(f.tx, { userId: f.ub, token: f.aInvitation.token })
      .catch(() => undefined);
    expect(asked).not.toContain(f.a.id);
  },
  runJob: async (f) => {
    const asA = await runProbe(f, f.a.id);
    expect(asA.outcome).toEqual({ status: 'completed' });
    expect(asA.seen[0]).toEqual([f.a.id]);
    const asB = await runProbe(f, f.b.id);
    expect(asB.seen[0]).toEqual([f.b.id]);
  },
  once: async (f) => {
    // A has claimed `xt-a-key`; B's claim on the same job and key is its own, and runs.
    await runProbe(f, f.a.id);
    const asB = await runProbe(f, f.b.id);
    expect(asB.seen[1]).toEqual(['ran']);
    const again = await runProbe(f, f.a.id);
    expect(again.seen[1]).toEqual(['skipped']);
  },
  enqueue: async (f) => {
    // enqueue sends the payload as given; the handler of a job enqueued for A runs scoped to A.
    const { seen } = await runProbe(f, f.a.id);
    expect(seen[0]).toEqual([f.a.id]);
    expect(seen[0]).not.toContain(f.b.id);
  },
  runNotificationDeliver: async (f) => {
    // A delivery job for B naming A's notification finds nothing, sends nothing, changes nothing.
    const { sent, deps } = recordingDeps();
    core.setNotificationJobDeps(deps);
    const notificationId = f.a.rows.notification?.notificationId ?? '';
    const before = await inWorkspace(f.tx, f.a.id, (s) =>
      s.select().from(schema.notification).where(eq(schema.notification.id, notificationId)),
    );
    const outcome = await core.runJob(
      core.notificationDeliver,
      {
        id: randomUUID(),
        data: { workspaceId: f.b.id, notificationId, channel: 'email' },
        retryCount: 0,
      },
      { db: f.tx as unknown as Database, logger },
    );
    expect(outcome).toEqual({ status: 'completed' });
    expect(sent).toEqual([]);
    const after = await inWorkspace(f.tx, f.a.id, (s) =>
      s.select().from(schema.notification).where(eq(schema.notification.id, notificationId)),
    );
    expect(after).toEqual(before);
  },
  runNotificationDigest: async (f) => {
    // ua asked for daily email of system notices in A and has one pending; B's digest never
    // includes or emails it.
    const { sent, deps } = recordingDeps();
    core.setNotificationJobDeps(deps);
    await inWorkspace(f.tx, f.a.id, async (s) => {
      await s
        .insert(schema.notificationPref)
        .values({
          workspaceId: f.a.id,
          userId: f.ua,
          category: 'system.notice',
          channel: 'email',
          enabled: true,
          digest: 'daily',
        })
        .onConflictDoUpdate({
          target: [
            schema.notificationPref.workspaceId,
            schema.notificationPref.userId,
            schema.notificationPref.category,
            schema.notificationPref.channel,
          ],
          set: { enabled: true, digest: 'daily' },
        });
      await s.insert(schema.notification).values({
        workspaceId: f.a.id,
        userId: f.ua,
        category: 'system.notice',
        title: 'A only',
        createdAt: new Date('2026-10-19T10:00:00Z'),
      });
    });
    const outcome = await core.runJob(
      core.notificationDigest,
      { id: randomUUID(), data: { workspaceId: f.b.id, digestDate: '2026-10-19' }, retryCount: 0 },
      { db: f.tx as unknown as Database, logger },
    );
    expect(outcome).toEqual({ status: 'completed' });
    expect(sent.map((m) => m.to)).not.toContain(await emailOf(f, f.ua));
    expect(sent).toEqual([]);
  },
  runNotificationDigestSchedule: async (f) => {
    // The scheduler lists every workspace, but hands on ids and dates only.
    const targets: core.DigestTarget[] = [];
    await core.runNotificationDigestSchedule(
      { db: f.tx, log: logger },
      {
        now: () => new Date('2026-10-19T13:00:00Z'),
        enqueue: (t) => {
          targets.push(t);
          return Promise.resolve();
        },
      },
    );
    const mine = targets.filter((t) => t.workspaceId === f.a.id || t.workspaceId === f.b.id);
    expect(mine).toHaveLength(2);
    for (const t of mine) expect(Object.keys(t).sort()).toEqual(['digestDate', 'workspaceId']);
  },
  runActivityDigestMember: async (f) => {
    // ua is not a member of B: B's per-member digest finds no one, counts nothing and sends nothing.
    const { sent, deps } = recordingDeps();
    core.setNotificationJobDeps(deps);
    const outcome = await core.runJob(
      core.activityDigestMember,
      {
        id: randomUUID(),
        data: { workspaceId: f.b.id, userId: f.ua, localDate: '2026-10-19' },
        retryCount: 0,
      },
      { db: f.tx as unknown as Database, logger },
    );
    expect(outcome).toEqual({ status: 'completed' });
    expect(sent).toEqual([]);
  },
  runActivityDigest: async (f) => {
    // B's fan-out lists B's members only; at a slot nobody chose it enqueues nothing.
    const outcome = await core.runJob(
      core.activityDigest,
      {
        id: randomUUID(),
        data: { workspaceId: f.b.id, localDate: '2026-10-19', slot: '18:00' },
        retryCount: 0,
      },
      { db: f.tx as unknown as Database, logger },
    );
    expect(outcome).toEqual({ status: 'completed' });
  },
  runActivityDigestSchedule: async (f) => {
    // The scheduler lists every workspace, but hands on ids, the local date and the slot only.
    const targets: core.ActivityDigestTarget[] = [];
    await core.runActivityDigestSchedule(
      { db: f.tx, log: logger },
      {
        now: () => new Date('2026-10-19T15:00:00Z'),
        enqueue: (t) => {
          targets.push(t);
          return Promise.resolve();
        },
      },
    );
    const mine = targets.filter((t) => t.workspaceId === f.a.id || t.workspaceId === f.b.id);
    expect(mine).toHaveLength(2);
    for (const t of mine)
      expect(Object.keys(t).sort()).toEqual(['localDate', 'slot', 'workspaceId']);
    expect(mine.every((t) => t.slot === '20:30')).toBe(true);
  },
  restrictMatter: async (f) => {
    const aMatter = f.a.rows.matter_restriction?.matterId ?? '';
    const before = await aRestrictions(f);
    const input = { matterId: aMatter, allowedUserIds: [f.ub] };
    // ub claiming workspace A, from no scope and from B's scope; and ub's own B scope cannot reach it.
    await expectDenied(core.restrictMatter(f.tx, { userId: f.ub, workspaceId: f.a.id }, input));
    await expectDenied(
      f.asB((s) => core.restrictMatter(s, { userId: f.ub, workspaceId: f.a.id }, input)),
    );
    await expectDenied(
      f.asB((s) =>
        core.restrictMatter(s, { userId: f.ua, workspaceId: f.a.id, role: 'owner' }, input),
      ),
    );
    expect(await aRestrictions(f)).toEqual(before);
  },
  listMatterRestrictions: async (f) => {
    await expectDenied(core.listMatterRestrictions(f.tx, { userId: f.ub, workspaceId: f.a.id }));
    await expectDenied(
      f.asB((s) => core.listMatterRestrictions(s, { userId: f.ub, workspaceId: f.a.id })),
    );
    // B's own list never includes A's restriction.
    const aMatter = f.a.rows.matter_restriction?.matterId ?? '';
    const own = await core.listMatterRestrictions(f.tx, { userId: f.ub, workspaceId: f.b.id });
    expect(own.map((r) => r.matterId)).not.toContain(aMatter);
  },
  assertMatterReadable: async (f) => {
    const aMatter = f.a.rows.matter_restriction?.matterId ?? '';
    await expectDenied(
      core.assertMatterReadable(f.tx, { userId: f.ub, workspaceId: f.a.id }, aMatter),
    );
    await expectDenied(
      f.asB((s) => core.assertMatterReadable(s, { userId: f.ub, workspaceId: f.a.id }, aMatter)),
    );
    // In B's own workspace, A's restriction row does not exist: the matter reads as unrestricted.
    expect(
      await core.assertMatterReadable(f.tx, { userId: f.ub, workspaceId: f.b.id }, aMatter),
    ).toBeNull();
  },
  // Court (#34): A's custom forum (two-tenant seed row) never reaches B.
  createWorkspaceForum: async (f) => {
    const before = await aForums(f);
    const input = {
      code: `xt.probe.${randomUUID().slice(0, 8)}`,
      court: 'Probe',
      jurisdictionKind: 'other' as const,
    };
    await expectDenied(
      core.createWorkspaceForum(f.tx, { userId: f.ub, workspaceId: f.a.id }, input),
    );
    await expectDenied(
      f.asB((s) => core.createWorkspaceForum(s, { userId: f.ub, workspaceId: f.a.id }, input)),
    );
    await expectDenied(
      f.asB((s) =>
        core.createWorkspaceForum(s, { userId: f.ua, workspaceId: f.a.id, role: 'owner' }, input),
      ),
    );
    expect(await aForums(f)).toEqual(before);
  },
  listForums: async (f) => {
    await expect(f.asB((s) => core.listForums(s, f.a.id))).rejects.toBeInstanceOf(TenancyError);
    const aForum = f.a.rows.forum?.forumId ?? '';
    const own = await f.asB((s) => core.listForums(s, f.b.id, { includeDisabled: true }));
    expect(own.map((row) => row.id)).not.toContain(aForum);
    expect(own.filter((row) => row.workspaceId !== null && row.workspaceId !== f.b.id)).toEqual([]);
  },
  listForumsByCity: async (f) => {
    await expect(f.asB((s) => core.listForumsByCity(s, f.a.id, 'Chennai'))).rejects.toBeInstanceOf(
      TenancyError,
    );
    const own = await core.listForumsByCity(f.tx, f.b.id, 'Chennai', { includeDisabled: true });
    expect(own.filter((row) => row.workspaceId !== null && row.workspaceId !== f.b.id)).toEqual([]);
  },
  getForum: async (f) => {
    const aForum = f.a.rows.forum?.forumId ?? '';
    await expect(f.asB((s) => core.getForum(s, f.a.id, aForum))).rejects.toBeInstanceOf(
      TenancyError,
    );
    await expectDenied(core.getForum(f.tx, f.b.id, aForum));
    expect((await aForums(f)).map((row) => row.id)).toContain(aForum);
  },
  // Adapter health (#372): the summary is tenant-free by design; B learns no id of A's.
  getAdapterHealthSummary: async (f) => {
    const aRun = f.a.rows.adapter_parse_run?.parseRunId ?? '';
    const before = await aParseRuns(f);
    expect(before.map((row) => row.id)).toContain(aRun);
    const unscoped = await core.getAdapterHealthSummary(f.tx);
    const fromB = await f.asB((s) => core.getAdapterHealthSummary(s));
    const fromA = await inWorkspace(f.tx, f.a.id, (s) => core.getAdapterHealthSummary(s));
    expect(fromB).toEqual(unscoped);
    expect(fromA).toEqual(unscoped);
    const keys = [
      'adapterId',
      'adapterVersion',
      'runs',
      'okRuns',
      'degradedRuns',
      'failedRuns',
      'rowsParsed',
      'rowsAnchored',
    ];
    for (const row of fromB) expect(Object.keys(row).sort()).toEqual([...keys].sort());
    const text = JSON.stringify(fromB);
    for (const id of [f.a.id, aRun, f.a.rows.adapter_parse_run?.documentId ?? '']) {
      expect(text).not.toContain(id);
    }
    // Both workspaces' seeded echo runs are counted, without saying whose they are.
    const echo = fromB.find((row) => row.adapterId === 'echo' && row.adapterVersion === '1.0.0');
    expect(echo?.runs).toBeGreaterThanOrEqual(2);
    expect(await aParseRuns(f)).toEqual(before);
  },
  // Courts read models (#397): B sees none of A's parse runs, halls or custom forum.
  getCourtsIndex: async (f) => {
    const probe = await aProbeRun(f);
    await expect(f.asB((s) => core.getCourtsIndex(s, f.a.id))).rejects.toBeInstanceOf(TenancyError);
    const own = JSON.stringify(await f.asB((s) => core.getCourtsIndex(s, f.b.id)));
    for (const forum of probe.forums) {
      expect(own).not.toContain(forum.id);
      expect(own).not.toContain(`"${forum.code}"`);
    }
    expect(await aParseRuns(f)).toEqual(probe.before);
  },
  getForumDetail: async (f) => {
    const probe = await aProbeRun(f);
    const aCode = probe.forums[0]?.code ?? '';
    await expect(f.asB((s) => core.getForumDetail(s, f.a.id, aCode))).rejects.toBeInstanceOf(
      TenancyError,
    );
    await expectDenied(core.getForumDetail(f.tx, f.b.id, aCode));
    await expectDenied(f.asB((s) => core.getForumDetail(s, f.b.id, aCode)));
    expect(await aForums(f)).toEqual(probe.forums);
  },
  getAdapterStatus: async (f) => {
    const probe = await aProbeRun(f);
    await expect(f.asB((s) => core.getAdapterStatus(s, f.a.id, 'echo'))).rejects.toBeInstanceOf(
      TenancyError,
    );
    const own = await f.asB((s) => core.getAdapterStatus(s, f.b.id, 'echo'));
    expect(own.lastParse?.hallsUnreadable).not.toContain('xt-a-hall');
    expect(own.lastParse?.at.getTime()).toBeLessThan(probe.run.createdAt.getTime());
    expect(await aParseRuns(f)).toEqual(probe.before);
  },
  listHallsSeen: async (f) => {
    const probe = await aProbeRun(f);
    await expect(
      f.asB((s) => core.listHallsSeen(s, f.a.id, 'test.echo.principal')),
    ).rejects.toBeInstanceOf(TenancyError);
    const own = await f.asB((s) => core.listHallsSeen(s, f.b.id, 'test.echo.principal'));
    expect(own.map((hall) => hall.hallNo)).not.toContain('xt-a-hall');
    expect(own.every((hall) => hall.lastListAt < probe.run.createdAt)).toBe(true);
    expect(await aParseRuns(f)).toEqual(probe.before);
  },
  // Matter graph (#362): A's matter, proceeding and document ids, as ub.
  createMatter: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const before = await aGraph(f);
    const ub = (workspaceId: string) => ({ userId: f.ub, workspaceId });
    await expectDenied(core.createMatter(deps, ub(f.a.id), { title: 'Probe' }));
    await expectDenied(
      f.asB((s) => core.createMatter({ ...deps, db: s }, ub(f.a.id), { title: 'Probe' })),
    );
    // A's owner member cannot own a matter of B.
    const aOwner = f.a.rows.member?.memberId ?? '';
    await expect(
      core.createMatter(deps, ub(f.b.id), { title: 'Probe', ownerMemberId: aOwner }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await aGraph(f)).toEqual(before);
    expect(events).toEqual([]);
  },
  updateMatter: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const matterId = f.a.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.updateMatter(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { matterId, patch: { title: 'Probe' } },
      ),
    );
    expect(events).toEqual([]);
  },
  archiveMatter: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const matterId = f.a.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.archiveMatter({ ...deps, db }, { userId: f.ub, workspaceId }, { matterId }),
    );
    expect(events).toEqual([]);
  },
  listMatters: async (f) => {
    const { deps } = graphDeps(f.tx);
    await expectDenied(core.listMatters(deps, { userId: f.ub, workspaceId: f.a.id }));
    await expectDenied(
      f.asB((s) => core.listMatters({ ...deps, db: s }, { userId: f.ub, workspaceId: f.a.id })),
    );
    const own = await core.listMatters(deps, { userId: f.ub, workspaceId: f.b.id }, { limit: 100 });
    const aMatters = (await aGraph(f)).matters.map((m) => m.id);
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.map((m) => m.id).filter((id) => aMatters.includes(id))).toEqual([]);
    expect(own.items.every((m) => m.workspaceId === f.b.id)).toBe(true);
  },
  createProceeding: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aMatter = f.a.rows.matter?.matterId ?? '';
    const aForum = f.a.rows.forum?.forumId ?? '';
    const bMatter = f.b.rows.matter?.matterId ?? '';
    const bForum = f.b.rows.forum?.forumId ?? '';
    const input = (matterId: string, forumId: string) => ({
      matterId,
      forumId,
      caseType: 'W.P.',
      provenance: PROBE_PROVENANCE,
    });
    await expectGraphDenied(f, (db, workspaceId) =>
      core.createProceeding(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        input(aMatter, workspaceId === f.a.id ? aForum : bForum),
      ),
    );
    // B's own matter before A's workspace forum: the forum does not exist for B.
    await expectDenied(
      core.createProceeding(deps, { userId: f.ub, workspaceId: f.b.id }, input(bMatter, aForum)),
    );
    expect(events).toEqual([]);
  },
  updateIdentifiers: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const proceedingId = f.a.rows.proceeding?.proceedingId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.updateIdentifiers(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { proceedingId, number: '1', year: 2026 },
      ),
    );
    expect(events).toEqual([]);
  },
  linkProceedings: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aFrom = f.a.rows.proceeding?.proceedingId ?? '';
    const aTo = f.a.rows.proceeding_link?.childId ?? '';
    const bProceeding = f.b.rows.proceeding?.proceedingId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.linkProceedings(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        {
          fromProceedingId: aFrom,
          toProceedingId: aTo,
          kind: 'connected',
          provenance: PROBE_PROVENANCE,
        },
      ),
    );
    // One end in B and one in A: the typed cross-workspace error, and nothing is linked in B.
    const bLinks = () => inWorkspace(f.tx, f.b.id, (s) => s.select().from(schema.proceedingLink));
    const bBefore = await bLinks();
    for (const [from, to] of [
      [bProceeding, aFrom],
      [aFrom, bProceeding],
    ] as const) {
      await expect(
        core.linkProceedings(
          deps,
          { userId: f.ub, workspaceId: f.b.id },
          {
            fromProceedingId: from,
            toProceedingId: to,
            kind: 'connected',
            provenance: PROBE_PROVENANCE,
          },
        ),
      ).rejects.toBeInstanceOf(core.CrossWorkspaceError);
    }
    expect(await bLinks()).toEqual(bBefore);
    expect(events).toEqual([]);
  },
  transitionProceeding: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aProceeding = f.a.rows.proceeding?.proceedingId ?? '';
    const bProceeding = f.b.rows.proceeding?.proceedingId ?? '';
    // A legal transition for A's filed proceeding: only the workspace boundary can refuse it.
    await expectGraphDenied(f, (db, workspaceId) =>
      core.transitionProceeding(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { proceedingId: aProceeding, to: 'sr_fr' },
      ),
    );
    expect(events).toEqual([]);
    // ub moves B's own proceeding; A's graph, history included, is unchanged.
    const before = await aGraph(f);
    const { stateChange } = await core.transitionProceeding(
      deps,
      { userId: f.ub, workspaceId: f.b.id },
      { proceedingId: bProceeding, to: 'sr_fr' },
    );
    expect(stateChange.workspaceId).toBe(f.b.id);
    expect(await aGraph(f)).toEqual(before);
  },
  findDuplicateProceedings: async (f) => {
    const { deps } = graphDeps(f.tx);
    const proceedingId = f.a.rows.proceeding?.proceedingId ?? '';
    const cnr = 'TNMH010012342026';
    await inWorkspace(f.tx, f.a.id, (s) =>
      s.update(schema.proceeding).set({ cnr }).where(eq(schema.proceeding.id, proceedingId)),
    );
    const input = { identity: { cnr } };
    await expectDenied(
      core.findDuplicateProceedings(deps, { userId: f.ub, workspaceId: f.a.id }, input),
    );
    await expectDenied(
      f.asB((s) =>
        core.findDuplicateProceedings(
          { ...deps, db: s },
          { userId: f.ub, workspaceId: f.a.id },
          input,
        ),
      ),
    );
    expect(
      await core.findDuplicateProceedings(deps, { userId: f.ub, workspaceId: f.b.id }, input),
    ).toEqual([]);
    // A's owner does find it: the probe itself is sound.
    const own = await core.findDuplicateProceedings(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      input,
    );
    expect(own.map((p) => p.id)).toEqual([proceedingId]);
  },
  createDocument: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const matterId = f.a.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.createDocument(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        {
          matterId,
          kind: 'other',
          storageKey: `ws/${workspaceId}/document/${randomUUID()}`,
          sha256: 'a'.repeat(64),
        },
      ),
    );
    expect(events).toEqual([]);
  },
  // Next date (#364): A's seeded canonical listing and its proceeding.
  proposeNextDate: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const { proceedingId } = await aListing(f);
    await expectGraphDenied(f, (db, workspaceId) =>
      core.proposeNextDate(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { proceedingId, date: '2027-01-04', provenance: PROBE_PROVENANCE },
      ),
    );
    expect(events).toEqual([]);
  },
  confirmNextDate: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const { listingId } = await aListing(f);
    await expectGraphDenied(f, (db, workspaceId) =>
      core.confirmNextDate(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { listingId, allowPast: true },
      ),
    );
    expect(events).toEqual([]);
  },
  getCanonicalNextDate: async (f) => {
    const { deps } = graphDeps(f.tx);
    const { listingId, proceedingId } = await aListing(f);
    await expectGraphDenied(f, (db, workspaceId) =>
      core.getCanonicalNextDate({ ...deps, db }, { userId: f.ub, workspaceId }, { proceedingId }),
    );
    // A's owner does read it: the probe itself is sound.
    const own = await core.getCanonicalNextDate(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { proceedingId },
    );
    expect(own?.id).toBe(listingId);
  },
  getMatterTimeline: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const matterId = f.a.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.getMatterTimeline({ ...deps, db }, { userId: f.ub, workspaceId }, { matterId }),
    );
    // A's owner does read it: the probe itself is sound.
    const own = await core.getMatterTimeline(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { matterId },
    );
    expect(Array.isArray(own)).toBe(true);
    expect(events).toEqual([]);
  },
  getMatterGraph: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const matterId = f.a.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.getMatterGraph({ ...deps, db }, { userId: f.ub, workspaceId }, { matterId }),
    );
    // A's owner does read it: the probe itself is sound.
    const own = await core.getMatterGraph(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { matterId },
    );
    expect(Array.isArray(own.nodes)).toBe(true);
    expect(events).toEqual([]);
  },
  getTimelineAnchors: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const matterId = f.a.rows.matter?.matterId ?? '';
    const anchorIds = [f.a.rows.anchor?.anchorId ?? randomUUID()];
    await expectGraphDenied(f, (db, workspaceId) =>
      core.getTimelineAnchors(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { matterId, anchorIds },
      ),
    );
    // A's owner may call it: the probe itself is sound, and an anchor of another matter is absent.
    const own = await core.getTimelineAnchors(
      deps,
      { userId: f.ua, workspaceId: f.a.id },
      { matterId, anchorIds: [randomUUID()] },
    );
    expect(own).toEqual([]);
    expect(events).toEqual([]);
  },
  // Matter read models and people (#386): A's matter from B, or ub claiming A, is NOT_FOUND; a
  // search from B finds none of A's matters, even by A's title; A's persons are never reached.
  searchMatters: async (f) => {
    const { deps } = graphDeps(f.tx);
    const [aMatter] = (await aGraph(f)).matters;
    const q = aMatter?.title ?? 'probe';
    await expectDenied(core.searchMatters(deps, { userId: f.ub, workspaceId: f.a.id }, { q }));
    await expectDenied(
      f.asB((s) => core.searchMatters({ ...deps, db: s }, { userId: f.ub, workspaceId: f.a.id })),
    );
    const aIds = (await aGraph(f)).matters.map((m) => m.id);
    for (const input of [{}, { q }, { q: 'W.P. 1/2026' }]) {
      const own = await core.searchMatters(deps, { userId: f.ub, workspaceId: f.b.id }, input);
      expect(own.items.filter((m) => aIds.includes(m.id))).toEqual([]);
    }
    const all = await core.searchMatters(deps, { userId: f.ub, workspaceId: f.b.id });
    expect(all.items.length).toBeGreaterThan(0);
  },
  ...Object.fromEntries(
    (
      [
        'getMatterOverview',
        'listMatterProceedingsTree',
        'listMatterPeople',
        'listMatterDocuments',
      ] as const
    ).map((name): [string, Case] => [
      name,
      async (f) => {
        const { deps, events } = graphDeps(f.tx);
        for (const matterId of [f.a.rows.matter?.matterId ?? '', await aProceedingMatter(f)]) {
          await expectGraphDenied(f, (db, workspaceId) =>
            core[name]({ ...deps, db }, { userId: f.ub, workspaceId }, { matterId }),
          );
          // A's owner does read it: the probe itself is sound.
          await core[name](deps, { userId: f.ua, workspaceId: f.a.id }, { matterId });
        }
        expect(events).toEqual([]);
      },
    ]),
  ),
  upsertPerson: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const personId = f.a.rows.person?.personId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.upsertPerson(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { personId, name: 'Probe (fictional)', kind: 'client', contact: { phone: '0' } },
      ),
    );
    await expectDenied(
      core.upsertPerson(deps, { userId: f.ub, workspaceId: f.a.id }, { name: 'P', kind: 'party' }),
    );
    expect(events).toEqual([]);
  },
  setRoleEdge: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aPerson = f.a.rows.person?.personId ?? '';
    const bPerson = f.b.rows.person?.personId ?? '';
    const aMatter = f.a.rows.matter?.matterId ?? '';
    const bMatter = f.b.rows.matter?.matterId ?? '';
    const aProceeding = f.a.rows.proceeding?.proceedingId ?? '';
    for (const input of [
      { fromPersonId: aPerson, matterId: aMatter },
      { fromPersonId: aPerson, proceedingId: aProceeding },
      { fromPersonId: aPerson, toPersonId: f.a.rows.role_edge?.partyId ?? '' },
    ]) {
      await expectGraphDenied(f, (db, workspaceId) =>
        core.setRoleEdge(
          { ...deps, db },
          { userId: f.ub, workspaceId },
          { kind: 'opposes', ...input },
        ),
      );
    }
    // One id of each workspace, as ub in B: NOT_FOUND, and B is unchanged.
    const bBefore = await aGraph(f, f.b.id);
    for (const input of [
      { fromPersonId: aPerson, matterId: bMatter },
      { fromPersonId: bPerson, matterId: aMatter },
      { fromPersonId: bPerson, proceedingId: aProceeding },
      { fromPersonId: bPerson, toPersonId: aPerson },
    ]) {
      await expectDenied(
        core.setRoleEdge(
          deps,
          { userId: f.ub, workspaceId: f.b.id },
          { kind: 'opposes', ...input },
        ),
      );
    }
    expect(await aGraph(f, f.b.id)).toEqual(bBefore);
    expect(events).toEqual([]);
  },
  setSensitive: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const matterId = f.a.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.setSensitive(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { matterId, sensitive: true },
      ),
    );
    expect(events).toEqual([]);
  },
  // Merges and splits (#365): A's ids from B, or ub claiming A, are denied; one id of each workspace
  // is the typed cross-workspace error.
  mergeMatters: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aMatter = f.a.rows.matter?.matterId ?? '';
    const aOther = await aProceedingMatter(f);
    const bMatter = f.b.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.mergeMatters(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { intoMatterId: aMatter, fromMatterId: aOther },
      ),
    );
    const asB = { userId: f.ub, workspaceId: f.b.id };
    await expectCrossWorkspace(f, () =>
      core.mergeMatters(deps, asB, { intoMatterId: bMatter, fromMatterId: aMatter }),
    );
    await expectCrossWorkspace(f, () =>
      core.mergeMatters(deps, asB, { intoMatterId: aMatter, fromMatterId: bMatter }),
    );
    expect(events).toEqual([]);
  },
  undoMerge: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aMatter = f.a.rows.matter?.matterId ?? '';
    const aOther = await aProceedingMatter(f);
    const aProceeding = f.a.rows.proceeding?.proceedingId ?? '';
    const payload = {
      op: 'matter.merge' as const,
      version: 1 as const,
      before: {
        intoMatterId: aMatter,
        fromMatterId: aOther,
        fromMatter: { mergedIntoMatterId: null, updatedAt: AT },
        rows: {
          proceeding: [{ id: aProceeding, updatedAt: AT }],
          document: [],
          roleEdge: [],
          obligation: [],
          task: [],
          mergedMatter: [],
        },
        links: [],
      },
      after: { intoMatterId: aMatter },
    };
    await expectGraphDenied(f, (db, workspaceId) =>
      core.undoMerge({ ...deps, db }, { userId: f.ub, workspaceId }, { payload }),
    );
    expect(events).toEqual([]);
  },
  splitMatter: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aOther = await aProceedingMatter(f);
    const aProceeding = f.a.rows.proceeding?.proceedingId ?? '';
    const bMatter = f.b.rows.matter?.matterId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.splitMatter(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { matterId: aOther, proceedingIds: [aProceeding], newTitle: 'Probe' },
      ),
    );
    await expectCrossWorkspace(f, () =>
      core.splitMatter(
        deps,
        { userId: f.ub, workspaceId: f.b.id },
        { matterId: bMatter, proceedingIds: [aProceeding], newTitle: 'Probe' },
      ),
    );
    expect(events).toEqual([]);
  },
  undoSplit: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aMatter = f.a.rows.matter?.matterId ?? '';
    const aOther = await aProceedingMatter(f);
    const aProceeding = f.a.rows.proceeding?.proceedingId ?? '';
    const payload = {
      op: 'matter.split' as const,
      version: 1 as const,
      before: {
        matterId: aOther,
        rows: { ...none, proceeding: [{ id: aProceeding, updatedAt: AT }] },
      },
      after: { newMatterId: aMatter },
    };
    await expectGraphDenied(f, (db, workspaceId) =>
      core.undoSplit({ ...deps, db }, { userId: f.ub, workspaceId }, { payload }),
    );
    expect(events).toEqual([]);
  },
  mergeProceedings: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aParent = f.a.rows.proceeding_link?.parentId ?? '';
    const aChild = f.a.rows.proceeding_link?.childId ?? '';
    const bProceeding = f.b.rows.proceeding?.proceedingId ?? '';
    await expectGraphDenied(f, (db, workspaceId) =>
      core.mergeProceedings(
        { ...deps, db },
        { userId: f.ub, workspaceId },
        { intoProceedingId: aParent, fromProceedingId: aChild },
      ),
    );
    for (const [intoProceedingId, fromProceedingId] of [
      [bProceeding, aParent],
      [aParent, bProceeding],
    ] as const) {
      await expectCrossWorkspace(f, () =>
        core.mergeProceedings(
          deps,
          { userId: f.ub, workspaceId: f.b.id },
          { intoProceedingId, fromProceedingId },
        ),
      );
    }
    expect(events).toEqual([]);
  },
  undoMergeProceedings: async (f) => {
    const { deps, events } = graphDeps(f.tx);
    const aParent = f.a.rows.proceeding_link?.parentId ?? '';
    const aChild = f.a.rows.proceeding_link?.childId ?? '';
    const aOther = await aProceedingMatter(f);
    const rows = {
      listing: [],
      order: [],
      obligation: [],
      task: [],
      roleEdge: [],
      stateChange: [],
      child: [],
      link: [],
    };
    const payload = {
      op: 'proceeding.merge' as const,
      version: 1 as const,
      before: {
        intoProceedingId: aParent,
        fromProceedingId: aChild,
        into: { id: aParent },
        from: { id: aChild, matter_id: aOther },
        rows,
        demotedListing: null,
        deletedLinks: [],
      },
      after: { intoProceedingId: aParent, identifierSources: {} },
    };
    await expectGraphDenied(f, (db, workspaceId) =>
      core.undoMergeProceedings({ ...deps, db }, { userId: f.ub, workspaceId }, { payload }),
    );
    expect(events).toEqual([]);
  },
  enqueueNotificationDelivery: async (f) => {
    // enqueueNotificationDelivery sends the payload as given; the handler is scoped to it.
    const { seen } = await runProbe(f, f.a.id);
    expect(seen[0]).toEqual([f.a.id]);
    expect(seen[0]).not.toContain(f.b.id);
  },
  // Support sessions (#308): ub owns B and is not staff; A's seed session was requested by ua.
  requestSession: async (f) => {
    const before = await aSupportSessions(f);
    const input = { workspaceId: f.a.id, reason: 'Probe' };
    await expectDenied(
      core.requestSession({ db: f.tx, staffUserId: f.ub, enqueueDelivery }, input),
    );
    await expectDenied(
      f.asB((s) => core.requestSession({ db: s, staffUserId: f.ub, enqueueDelivery }, input)),
    );
    expect(await aSupportSessions(f)).toEqual(before);
  },
  grantSession: async (f) => {
    const before = await aSupportSessions(f);
    const sessionId = f.a.rows.support_session?.id ?? '';
    await expectDenied(
      core.grantSession({ db: f.tx, userId: f.ub, workspaceId: f.a.id }, { sessionId }),
    );
    // As B's owner, A's session does not exist in B.
    await expectDenied(
      core.grantSession({ db: f.tx, userId: f.ub, workspaceId: f.b.id }, { sessionId }),
    );
    expect(await aSupportSessions(f)).toEqual(before);
  },
  denySession: async (f) => {
    const before = await aSupportSessions(f);
    const sessionId = f.a.rows.support_session?.id ?? '';
    await expectDenied(
      core.denySession({ db: f.tx, userId: f.ub, workspaceId: f.a.id }, { sessionId }),
    );
    await expectDenied(
      core.denySession({ db: f.tx, userId: f.ub, workspaceId: f.b.id }, { sessionId }),
    );
    expect(await aSupportSessions(f)).toEqual(before);
  },
  revokeSession: async (f) => {
    const before = await aSupportSessions(f);
    const sessionId = f.a.rows.support_session?.id ?? '';
    await expectDenied(
      core.revokeSession({ db: f.tx, userId: f.ub, workspaceId: f.a.id }, { sessionId }),
    );
    await expectDenied(
      core.revokeSession({ db: f.tx, userId: f.ub, workspaceId: f.b.id }, { sessionId }),
    );
    expect(await aSupportSessions(f)).toEqual(before);
  },
  listSupportSessions: async (f) => {
    await expect(f.asB((s) => core.listSupportSessions(s, f.a.id))).rejects.toBeInstanceOf(
      TenancyError,
    );
    const own = await f.asB((s) => core.listSupportSessions(s, f.b.id));
    expect(own.filter((row) => row.workspaceId !== f.b.id)).toEqual([]);
  },
  activeSupportSession: async (f) => {
    await expect(f.asB((s) => core.activeSupportSession(s, f.a.id))).rejects.toBeInstanceOf(
      TenancyError,
    );
    expect(await f.asB((s) => core.activeSupportSession(s, f.b.id))).toBeNull();
  },
  assertActiveSupportSession: async (f) => {
    await expectDenied(core.assertActiveSupportSession(f.ub, f.a.id, { db: f.tx }));
  },
  withSupportSession: async (f) => {
    await expectDenied(core.withSupportSession({ db: f.tx, staffUserId: f.ub }, f.a.id));
  },
  // the staff console (#314): ub is not staff, so it lists nothing, opens none of A's sessions
  // and gets no view of A; A's sessions are unchanged.
  listStaffSupportSessions: async (f) => {
    const before = await aSupportSessions(f);
    expect(await core.listStaffSupportSessions(f.tx, f.ub)).toEqual([]);
    expect(await core.listStaffSupportSessions(f.tx, f.ua)).toEqual([]);
    expect(await aSupportSessions(f)).toEqual(before);
  },
  staffSupportSession: async (f) => {
    const sessionId = f.a.rows.support_session?.id ?? '';
    expect(await core.staffSupportSession(f.tx, f.ub, sessionId)).toBeNull();
    expect(await core.staffSupportSession(f.tx, f.ua, sessionId)).toBeNull();
  },
  readSupportWorkspaceView: async (f) => {
    const before = await aSupportSessions(f);
    await expectDenied(core.readSupportWorkspaceView({ db: f.tx, staffUserId: f.ub }, f.a.id));
    expect(await aSupportSessions(f)).toEqual(before);
  },
  isActiveStaff: async (f) => {
    expect(await core.isActiveStaff(f.tx, f.ub)).toBe(false);
    expect(await f.asB((s) => core.isActiveStaff(s, f.ub))).toBe(false);
  },
  staffMember: async (f) => {
    // ub is not staff; and staff_user is global, so B's scope reads A's user exactly as unscoped.
    expect(await core.staffMember(f.tx, f.ub)).toBeNull();
    const ua = await core.staffMember(f.tx, f.ua);
    expect(await f.asB((s) => core.staffMember(s, f.ua))).toEqual(ua);
  },
  countActiveStaff: async (f) => {
    // staff_user is global: B's scope sees the same count as the unscoped handle, no tenant rows.
    const all = await core.countActiveStaff(f.tx);
    expect(await f.asB((s) => core.countActiveStaff(s))).toBe(all);
  },
  staffWorkspaceSearch: async (f) => {
    // ub is not staff: the definer function refuses, by slug and by A's owner email alike.
    const before = await aWorkspaceRow(f);
    const [owner] = await f.tx
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, f.ua));
    await expectDenied(core.staffWorkspaceSearch(f.tx, f.ub, f.a.slug));
    await expectDenied(core.staffWorkspaceSearch(f.tx, f.ub, owner?.email ?? 'x@example.test'));
    expect(await aWorkspaceRow(f)).toEqual(before);
  },
  staffWorkspaceMetadata: async (f) => {
    const before = await aWorkspaceRow(f);
    await expectDenied(core.staffWorkspaceMetadata(f.tx, f.ub, f.a.id));
    await expectDenied(core.staffWorkspaceMetadata(f.tx, f.ub, 'not-a-uuid'));
    expect(await aWorkspaceRow(f)).toEqual(before);
  },
  staffWorkspaceUsage: async (f) => {
    // ub is not staff: the definer functions refuse, for A's id and a malformed one alike.
    await budgetA(f);
    const before = await aBudgetState(f);
    await expectDenied(core.staffWorkspaceUsage(f.tx, f.ub, f.a.id));
    await expectDenied(core.staffWorkspaceUsage(f.tx, f.ub, 'not-a-uuid'));
    expect(await aBudgetState(f)).toEqual(before);
  },
  staffAuditEvents: async (f) => {
    const before = await aWorkspaceRow(f);
    await expectDenied(core.staffAuditEvents(f.tx, f.ub));
    await expectDenied(core.staffAuditEvents(f.tx, f.ua));
    expect(await aWorkspaceRow(f)).toEqual(before);
  },
  expireSupportSessions: async (f) => {
    const before = await aSupportSessions(f);
    await core.expireSupportSessions(f.tx);
    // A's pending request is not a grant, so the sweep leaves it alone.
    expect(await aSupportSessions(f)).toEqual(before);
  },
  endStaffSupportSessions: async (f) => {
    const before = await aSupportSessions(f);
    // Only ub's own request (B's seed row) ends; A's sessions, requested by ua, are untouched.
    expect(await core.endStaffSupportSessions(f.tx, f.ub)).toBe(1);
    expect(await aSupportSessions(f)).toEqual(before);
  },
  supportSessionExpire: async (f) => {
    const before = await aSupportSessions(f);
    const outcome = await core.runJob(
      core.supportSessionExpire,
      { id: randomUUID(), data: {}, retryCount: 0 },
      { db: f.tx as unknown as Database, logger },
    );
    expect(outcome).toEqual({ status: 'completed' });
    expect(await aSupportSessions(f)).toEqual(before);
  },
  retentionSweep: async (f) => {
    const outcome = await core.runJob(
      core.retentionSweep,
      { id: randomUUID(), data: {}, retryCount: 0 },
      { db: f.tx as unknown as Database, logger },
    );
    expect(outcome).toEqual({ status: 'completed' });
    // Recent effects of both workspaces survive the cross-workspace purge.
    for (const t of [f.a, f.b]) {
      const rows = await inWorkspace(f.tx, t.id, (s) =>
        s
          .select({ id: schema.jobEffect.id })
          .from(schema.jobEffect)
          .where(
            and(
              eq(schema.jobEffect.workspaceId, t.id),
              eq(schema.jobEffect.id, t.rows.job_effect?.jobEffectId ?? ''),
            ),
          ),
      );
      expect(rows).toHaveLength(1);
    }
  },
  increment: async (f) => {
    // From inside B's scope, metering against A is a tenancy violation and writes nothing of A's.
    await core.increment({ db: f.tx, workspaceId: f.a.id }, 'ai.spend_paise', 5, {
      idempotencyKey: 'xt-usage-key',
    });
    const before = await aUsage(f);
    const error: unknown = await f
      .asB((s) =>
        core.increment({ db: s, workspaceId: f.a.id }, 'ai.spend_paise', 1, {
          idempotencyKey: 'xt-usage-other',
        }),
      )
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(TenancyError);
    expect(await aUsage(f)).toEqual(before);
    // B reusing A's idempotency key is B's own claim: applied for B, A unchanged.
    const asB = await core.increment({ db: f.tx, workspaceId: f.b.id }, 'ai.spend_paise', 2, {
      idempotencyKey: 'xt-usage-key',
    });
    expect(asB).toEqual({ applied: true, value: 2 });
    expect(await aUsage(f)).toEqual(before);
  },
  getUsage: async (f) => {
    await core.increment({ db: f.tx, workspaceId: f.a.id }, 'ocr.pages', 9, {
      idempotencyKey: 'xt-usage-read',
    });
    expect(await f.asB((s) => core.getUsage({ db: s, workspaceId: f.b.id }, 'ocr.pages'))).toBe(0);
    await expect(
      f.asB((s) => core.getUsage({ db: s, workspaceId: f.a.id }, 'ocr.pages')),
    ).rejects.toBeInstanceOf(TenancyError);
  },
  reserve: async (f) => {
    await budgetA(f);
    await core.reserve(aCtx(f), { estimatePaise: 100, purpose: 'xt.probe' });
    const before = await aBudgetState(f);
    await expect(
      f.asB((s) =>
        core.reserve(
          { db: s, workspaceId: f.a.id, now: () => USAGE_NOW },
          { estimatePaise: 1, purpose: 'xt.probe' },
        ),
      ),
    ).rejects.toBeInstanceOf(TenancyError);
    expect(await aBudgetState(f)).toEqual(before);
    // B reserving for itself holds B's own budget and never counts A's reservation.
    await core.setBudgetOverride(bCtx(f), {
      limitPaise: 1_000,
      reason: 'xt fixture',
      expiresAt: new Date(USAGE_NOW.getTime() + 86_400_000),
      staffUserId: f.ub,
    });
    // B holds its own seeded 100; 900 more fits exactly, so A's 200 reserved paise are not counted.
    const own = await core.reserve(bCtx(f), { estimatePaise: 900, purpose: 'xt.probe' });
    expect(own.workspaceId).toBe(f.b.id);
    expect((await aBudgetState(f)).reservations).toEqual(before.reservations);
  },
  commit: async (f) => {
    await budgetA(f);
    const held = await core.reserve(aCtx(f), { estimatePaise: 100, purpose: 'xt.probe' });
    const before = await aBudgetState(f);
    // B's own context with A's reservation is refused; A's context inside B's scope is a violation.
    await expect(core.commit(bCtx(f), held, 50)).rejects.toBeInstanceOf(TypeError);
    await expect(
      f.asB((s) => core.commit({ db: s, workspaceId: f.a.id, now: () => USAGE_NOW }, held, 50)),
    ).rejects.toBeInstanceOf(TenancyError);
    expect(await aBudgetState(f)).toEqual(before);
  },
  release: async (f) => {
    await budgetA(f);
    const held = await core.reserve(aCtx(f), { estimatePaise: 100, purpose: 'xt.probe' });
    const before = await aBudgetState(f);
    await expect(core.release(bCtx(f), held)).rejects.toBeInstanceOf(TypeError);
    await expect(
      f.asB((s) => core.release({ db: s, workspaceId: f.a.id, now: () => USAGE_NOW }, held)),
    ).rejects.toBeInstanceOf(TenancyError);
    expect(await aBudgetState(f)).toEqual(before);
  },
  reapExpiredReservations: async (f) => {
    await budgetA(f);
    const old = new Date(USAGE_NOW.getTime() - 3_600_000);
    await core.reserve({ ...aCtx(f), now: () => old }, { estimatePaise: 100, purpose: 'xt.probe' });
    const before = await aBudgetState(f);
    expect(before.reservations.length).toBeGreaterThan(1);
    await expect(
      f.asB((s) =>
        core.reapExpiredReservations({ db: s, workspaceId: f.a.id, now: () => USAGE_NOW }),
      ),
    ).rejects.toBeInstanceOf(TenancyError);
    // B reaping its own workspace deletes none of A's expired rows.
    expect(await core.reapExpiredReservations(bCtx(f))).toBe(0);
    expect(await aBudgetState(f)).toEqual(before);
  },
  getAiBudget: async (f) => {
    await budgetA(f);
    const asB = await f.asB((s) =>
      core.getAiBudget({ db: s, workspaceId: f.b.id, now: () => USAGE_NOW }),
    );
    expect(asB).not.toEqual({ budgetPaise: 100_000, source: 'override' });
    await expect(
      f.asB((s) => core.getAiBudget({ db: s, workspaceId: f.a.id, now: () => USAGE_NOW })),
    ).rejects.toBeInstanceOf(TenancyError);
  },
  setBudgetOverride: async (f) => {
    const before = await aBudgetState(f);
    await expect(
      f.asB((s) =>
        core.setBudgetOverride(
          { db: s, workspaceId: f.a.id, now: () => USAGE_NOW },
          {
            limitPaise: 1,
            reason: 'xt attack',
            expiresAt: new Date(USAGE_NOW.getTime() + 86_400_000),
            staffUserId: f.ub,
          },
        ),
      ),
    ).rejects.toBeInstanceOf(TenancyError);
    expect(await aBudgetState(f)).toEqual(before);
  },
  expireBudgetOverride: async (f) => {
    await budgetA(f);
    const [target] = await inWorkspace(f.tx, f.a.id, (s) =>
      s.select({ id: schema.budgetOverride.id }).from(schema.budgetOverride),
    );
    if (!target) throw new Error('no override seeded for A');
    const overrides = () =>
      inWorkspace(f.tx, f.a.id, (s) =>
        s
          .select({
            id: schema.budgetOverride.id,
            expiresAt: schema.budgetOverride.expiresAt,
            expiredAt: schema.budgetOverride.expiredAt,
          })
          .from(schema.budgetOverride)
          .orderBy(schema.budgetOverride.id),
      );
    const before = { state: await aBudgetState(f), overrides: await overrides() };
    const input = { overrideId: target.id, reason: 'xt attack', staffUserId: f.ub };
    // B's own context cannot reach A's override; A's context inside B's scope is a violation.
    await expect(core.expireBudgetOverride(bCtx(f), input)).rejects.toBeInstanceOf(TypeError);
    await expect(
      f.asB((s) =>
        core.expireBudgetOverride({ db: s, workspaceId: f.a.id, now: () => USAGE_NOW }, input),
      ),
    ).rejects.toBeInstanceOf(TenancyError);
    expect({ state: await aBudgetState(f), overrides: await overrides() }).toEqual(before);
  },
  activeOverride: async (f) => {
    await budgetA(f);
    // The query filters by workspace and RLS hides A's rows from B's scope, so B sees none.
    expect(await f.asB((s) => core.activeOverride(s, f.a.id, USAGE_NOW))).toBeUndefined();
    expect(await f.asB((s) => core.activeOverride(s, f.b.id, USAGE_NOW))).toBeUndefined();
  },
  assertWithinFairUse: async (f) => {
    // A's metered OCR pages are A's own: B's fair-use check never counts them.
    await core.increment(aCtx(f), 'ocr.pages', 1_000_000, { idempotencyKey: 'xt-fair-use' });
    const before = await aBudgetState(f);
    await expect(
      f.asB((s) =>
        core.assertWithinFairUse(
          { db: s, workspaceId: f.a.id, now: () => USAGE_NOW },
          'ocr.pages',
          1,
        ),
      ),
    ).rejects.toBeInstanceOf(TenancyError);
    await f.asB((s) =>
      core.assertWithinFairUse(
        { db: s, workspaceId: f.b.id, now: () => USAGE_NOW },
        'ocr.pages',
        1,
      ),
    );
    expect((await aBudgetState(f)).usage).toEqual(before.usage);
  },
  checkAiBudgetThresholds: async (f) => {
    await budgetA(f);
    await core.increment(aCtx(f), 'ai.spend_paise', 100_000, { idempotencyKey: 'xt-threshold' });
    const before = await aBudgetState(f);
    const notifications = () =>
      inWorkspace(f.tx, f.a.id, (s) =>
        s.select({ id: schema.notification.id }).from(schema.notification),
      );
    const notificationsBefore = await notifications();
    const delivered: unknown[] = [];
    const enqueueDelivery = (job: unknown) => {
      delivered.push(job);
      return Promise.resolve();
    };
    await expect(
      f.asB((s) =>
        core.checkAiBudgetThresholds({
          db: s,
          workspaceId: f.a.id,
          now: () => USAGE_NOW,
          enqueueDelivery,
        }),
      ),
    ).rejects.toBeInstanceOf(TenancyError);
    // B's own check sees B's spend (none), not A's exceeded budget, and notifies nobody.
    const own = await core.checkAiBudgetThresholds({ ...bCtx(f), enqueueDelivery });
    expect(own).toMatchObject({ level: 'ok', notified: 0 });
    expect(delivered).toEqual([]);
    expect(await notifications()).toEqual(notificationsBefore);
    expect(await aBudgetState(f)).toEqual(before);
  },
  getWorkspaceFairnessConcurrency: async (f) => {
    await expect(
      f.asB((s) => core.getWorkspaceFairnessConcurrency(s, f.a.id, USAGE_NOW)),
    ).rejects.toBeInstanceOf(TenancyError);
    const own = await f.asB((s) => core.getWorkspaceFairnessConcurrency(s, f.b.id, USAGE_NOW));
    expect(own).toBeGreaterThanOrEqual(1);
  },
  reconcileAiCalls: async (f) => {
    // A's seeded ai_call plus a ledger row for it; B's reconciliation sees neither.
    const aiCallId = f.a.rows.ai_call?.aiCallId;
    if (aiCallId === undefined) throw new Error('two-tenant ai_call seed missing');
    await core.increment({ db: f.tx, workspaceId: f.a.id }, 'ai.spend_paise', 3, {
      idempotencyKey: 'xt-usage-reconcile',
      metadata: { ai_call_id: aiCallId },
    });
    const before = await aUsage(f);
    const own = await f.asB((s) => core.reconcileAiCalls({ db: s, workspaceId: f.b.id }));
    expect(own.mismatches.map((m) => m.aiCallId)).not.toContain(aiCallId);
    expect(own.matched).toBe(0);
    await expect(
      f.asB((s) => core.reconcileAiCalls({ db: s, workspaceId: f.a.id })),
    ).rejects.toBeInstanceOf(TenancyError);
    expect(await aUsage(f)).toEqual(before);
  },
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

afterEach(() => {
  core.setNotificationJobDeps(null);
  core.setAuditSink(null);
  core.setEntitlements(null);
  core.clearReassignProviders();
});

describe('cross-tenant core services: ub on workspace B against A', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !(name in SERVICE_TESTS))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const member = seeded.a.rows.member;
      const invitation = seeded.a.rows.invitation;
      if (!member?.memberId || !member.userId || !invitation?.invitationId || !invitation.token) {
        throw new Error('two-tenant seed rows missing');
      }
      await run({
        ...seeded,
        tx,
        asB: (fn) => inWorkspace(tx, seeded.b.id, fn, seeded.ub),
        aMember: { memberId: member.memberId, userId: member.userId },
        aInvitation: { invitationId: invitation.invitationId, token: invitation.token },
      });
    });
  });
});
