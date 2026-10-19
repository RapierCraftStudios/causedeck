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

async function aRestrictions(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, (s) =>
    s.select().from(schema.matterRestriction).orderBy(schema.matterRestriction.id),
  );
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
  enqueueNotificationDelivery: async (f) => {
    // enqueueNotificationDelivery sends the payload as given; the handler is scoped to it.
    const { seen } = await runProbe(f, f.a.id);
    expect(seen[0]).toEqual([f.a.id]);
    expect(seen[0]).not.toContain(f.b.id);
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
