// Cross-tenant core services (#19, #209): user `ub`, working in workspace B, calls every exported
// `@causedeck/core` service with workspace A's ids and must get NOT_FOUND or FORBIDDEN (`denies`),
// nothing of A's (`rls-empty`), or a result scoped to itself (`self-scoped`). `caller-checked`
// services are covered through the caller that checks. A's rows must be unchanged afterwards.
// The cases are driven by the registry in `@causedeck/db/testing/cross-tenant-registry`, so a
// registered service without a case here fails.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import type { Mailer } from '@causedeck/auth/mailer';
import { schema, type Database, type Transaction } from '@causedeck/db';
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

async function aWorkspace(f: Fixture) {
  const [row] = await inWorkspace(f.tx, f.a.id, (s) =>
    s.select().from(schema.organization).where(eq(schema.organization.id, f.a.id)),
  );
  return row;
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

const CASES: Record<string, Case> = {
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
};

const registered = Object.entries(SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

afterEach(() => {
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
