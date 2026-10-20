// Support sessions (#308): staff request, the owner grants (<= 4 h, default 1 h), denies or
// revokes; a grant is never extended; sessions expire by time and by the job; staff read content
// only through the read-only support context, every read audited as `support.view` and every write
// denied by `can()` and audited as `access.denied`. Staff rows are committed through the owner role
// (the app role cannot write `staff_user`); everything else runs in rolled-back transactions.
import { randomUUID } from 'node:crypto';

import { isForbiddenError } from '@causedeck/auth/policy';
import { Secret } from '@causedeck/config/env';
import { createDb, schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { createLogger } from '@causedeck/observability';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runJob, supportSessionExpire } from '../../jobs/index.ts';
import { WorkspaceError } from '../../workspaces/index.ts';
import {
  assertActiveSupportSession,
  denySession,
  endStaffSupportSessions,
  expireSupportSessions,
  grantSession,
  isActiveStaff,
  requestSession,
  revokeSession,
  SupportSessionInactiveError,
  withSupportSession,
  type SupportSession,
} from '../index.ts';

let owner: Database;
let staffId: string;
let disabledStaffId: string;

async function newUser(db: Database | Transaction, label: string): Promise<string> {
  const [row] = await db
    .insert(schema.user)
    .values({ name: label, email: `${label}-${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

beforeAll(async () => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  staffId = await newUser(owner, 'staff');
  disabledStaffId = await newUser(owner, 'staff-disabled');
  await owner.insert(schema.staffUser).values([
    { userId: staffId, role: 'support' },
    { userId: disabledStaffId, role: 'support', disabledAt: new Date() },
  ]);
});

afterAll(async () => {
  await owner.execute(sql`delete from "user" where id in (${staffId}, ${disabledStaffId})`);
  await owner.$client.end();
});

interface Seed {
  workspaceId: string;
  ownerId: string;
  advocateId: string;
}

async function seed(tx: Transaction): Promise<Seed> {
  const workspaceId = randomUUID();
  const ownerId = await newUser(tx, 'owner');
  const advocateId = await newUser(tx, 'advocate');
  await inWorkspace(tx, workspaceId, async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Chambers', slug: `sup-${workspaceId}` });
    await s.insert(schema.member).values([
      { organizationId: workspaceId, userId: ownerId, role: 'owner' },
      { organizationId: workspaceId, userId: advocateId, role: 'advocate' },
    ]);
  });
  return { workspaceId, ownerId, advocateId };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

async function audits(tx: Transaction, workspaceId: string, action: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select({
        actorUserId: schema.auditEvent.actorUserId,
        actorKind: schema.auditEvent.actorKind,
        targetKind: schema.auditEvent.targetKind,
        targetId: schema.auditEvent.targetId,
        outcome: schema.auditEvent.outcome,
        metadata: schema.auditEvent.metadata,
      })
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.workspaceId, workspaceId), eq(schema.auditEvent.action, action)),
      ),
  );
}

async function sessionRow(tx: Transaction, s: SupportSession): Promise<SupportSession> {
  const [row] = await inWorkspace(tx, s.workspaceId, (q) =>
    q.select().from(schema.supportSession).where(eq(schema.supportSession.id, s.id)),
  );
  if (!row) throw new Error('session missing');
  return row;
}

/** Move a granted session's window into the past (as if `minutesAgo` had elapsed). */
async function age(tx: Transaction, s: SupportSession, minutesAgo: number): Promise<void> {
  await inWorkspace(tx, s.workspaceId, (q) =>
    q.execute(sql`update support_session
                     set granted_at = granted_at - make_interval(mins => ${minutesAgo}),
                         expires_at = expires_at - make_interval(mins => ${minutesAgo})
                   where id = ${s.id}`),
  );
}

async function requested(tx: Transaction, w: Seed, scope: 'view' | 'metadata' = 'view') {
  return requestSession(
    { db: tx, staffUserId: staffId },
    { workspaceId: w.workspaceId, reason: 'Customer reported a sync issue', scope },
  );
}

async function granted(tx: Transaction, w: Seed, minutes?: number, scope?: 'view' | 'metadata') {
  const s = await requested(tx, w, scope);
  return grantSession(
    { db: tx, userId: w.ownerId, workspaceId: w.workspaceId },
    minutes === undefined ? { sessionId: s.id } : { sessionId: s.id, minutes },
  );
}

const minutesOf = (s: SupportSession) =>
  ((s.expiresAt?.getTime() ?? 0) - (s.grantedAt?.getTime() ?? 0)) / 60_000;

describe('requestSession', () => {
  it('lets active staff request with a reason; others are refused', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const s = await requested(tx, w);
      expect(s).toMatchObject({ status: 'requested', scope: 'view', requestedByStaff: staffId });
      expect(await isActiveStaff(tx, staffId)).toBe(true);
      expect(await isActiveStaff(tx, disabledStaffId)).toBe(false);

      const input = { workspaceId: w.workspaceId, reason: 'Help' };
      expect(await codeOf(requestSession({ db: tx, staffUserId: w.ownerId }, input))).toBe(
        'FORBIDDEN',
      );
      expect(await codeOf(requestSession({ db: tx, staffUserId: disabledStaffId }, input))).toBe(
        'FORBIDDEN',
      );
      expect(
        await codeOf(requestSession({ db: tx, staffUserId: staffId }, { ...input, reason: '   ' })),
      ).toBe('VALIDATION');
      expect(
        await codeOf(
          requestSession({ db: tx, staffUserId: staffId }, { ...input, workspaceId: randomUUID() }),
        ),
      ).toBe('NOT_FOUND');
    });
  });
});

describe('grantSession', () => {
  it('is owner only, defaults to 1 h, allows up to 4 h and audits the start', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const pending = await requested(tx, w);
      expect(
        await codeOf(
          grantSession(
            { db: tx, userId: w.advocateId, workspaceId: w.workspaceId },
            { sessionId: pending.id },
          ),
        ),
      ).toBe('FORBIDDEN');

      const s = await grantSession(
        { db: tx, userId: w.ownerId, workspaceId: w.workspaceId },
        { sessionId: pending.id },
      );
      expect(s).toMatchObject({ status: 'granted', grantedByUser: w.ownerId });
      expect(minutesOf(s)).toBe(60);
      expect(minutesOf(await granted(tx, w, 240))).toBe(240);

      expect(await audits(tx, w.workspaceId, 'support.session_started')).toContainEqual(
        expect.objectContaining({
          actorUserId: staffId,
          actorKind: 'staff',
          targetKind: 'support_session',
          targetId: s.id,
        }),
      );
    });
  });

  it('rejects more than 4 h, less than a minute and fractional minutes', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const pending = await requested(tx, w);
      const ctx = { db: tx, userId: w.ownerId, workspaceId: w.workspaceId };
      for (const minutes of [241, 0, -5, 30.5]) {
        expect(await codeOf(grantSession(ctx, { sessionId: pending.id, minutes }))).toBe(
          'VALIDATION',
        );
      }
      expect((await sessionRow(tx, pending)).status).toBe('requested');
    });
  });

  it('never extends a session: a granted, expired or denied session cannot be granted again', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const ctx = { db: tx, userId: w.ownerId, workspaceId: w.workspaceId };
      const s = await granted(tx, w, 30);
      expect(await codeOf(grantSession(ctx, { sessionId: s.id, minutes: 240 }))).toBe('CONFLICT');
      expect((await sessionRow(tx, s)).expiresAt).toEqual(s.expiresAt);

      await age(tx, s, 31);
      await expireSupportSessions(tx);
      expect(await codeOf(grantSession(ctx, { sessionId: s.id }))).toBe('CONFLICT');

      const denied = await requested(tx, w);
      expect((await denySession(ctx, { sessionId: denied.id })).status).toBe('denied');
      expect(await codeOf(grantSession(ctx, { sessionId: denied.id }))).toBe('CONFLICT');
      expect(
        await codeOf(
          denySession(
            { db: tx, userId: w.advocateId, workspaceId: w.workspaceId },
            { sessionId: (await requested(tx, w)).id },
          ),
        ),
      ).toBe('FORBIDDEN');
    });
  });
});

describe('assertActiveSupportSession and expiry', () => {
  it('is active only while granted and unexpired, and never for disabled staff', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const pending = await requested(tx, w);
      await expect(
        assertActiveSupportSession(staffId, w.workspaceId, { db: tx }),
      ).rejects.toBeInstanceOf(SupportSessionInactiveError);

      const s = await grantSession(
        { db: tx, userId: w.ownerId, workspaceId: w.workspaceId },
        { sessionId: pending.id },
      );
      expect((await assertActiveSupportSession(staffId, w.workspaceId, { db: tx })).id).toBe(s.id);
      await expect(
        assertActiveSupportSession(disabledStaffId, w.workspaceId, { db: tx }),
      ).rejects.toBeInstanceOf(SupportSessionInactiveError);

      // Elapsed but not yet swept: already inactive.
      await age(tx, s, 61);
      expect((await sessionRow(tx, s)).status).toBe('granted');
      await expect(
        assertActiveSupportSession(staffId, w.workspaceId, { db: tx }),
      ).rejects.toBeInstanceOf(SupportSessionInactiveError);
    });
  });

  it('the expiry job flips elapsed grants to expired and audits the end', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const elapsed = await granted(tx, w, 60);
      const live = await granted(tx, w, 60);
      await age(tx, elapsed, 61);

      const silent = createLogger({ service: 'test', level: 'silent' });
      const outcome = await runJob(
        supportSessionExpire,
        { id: randomUUID(), data: {}, retryCount: 0 },
        { db: tx as unknown as Database, logger: silent },
      );
      expect(outcome).toEqual({ status: 'completed' });

      expect(await sessionRow(tx, elapsed)).toMatchObject({ status: 'expired' });
      expect((await sessionRow(tx, elapsed)).endedAt).not.toBeNull();
      expect((await sessionRow(tx, live)).status).toBe('granted');
      const ended = await audits(tx, w.workspaceId, 'support.session_ended');
      expect(ended).toEqual([
        expect.objectContaining({
          actorKind: 'staff',
          targetId: elapsed.id,
          metadata: { endReason: 'expired' },
        }),
      ]);
    });
  });
});

describe('revokeSession and disabling staff', () => {
  it('the owner or the requesting staff member ends a session at once; nobody else can', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const s = await granted(tx, w);
      expect(
        await codeOf(
          revokeSession(
            { db: tx, userId: w.advocateId, workspaceId: w.workspaceId },
            { sessionId: s.id },
          ),
        ),
      ).toBe('FORBIDDEN');
      const ended = await revokeSession(
        { db: tx, userId: w.ownerId, workspaceId: w.workspaceId },
        { sessionId: s.id },
      );
      expect(ended.status).toBe('ended');
      await expect(
        assertActiveSupportSession(staffId, w.workspaceId, { db: tx }),
      ).rejects.toBeInstanceOf(SupportSessionInactiveError);
      expect(await audits(tx, w.workspaceId, 'support.session_ended')).toEqual([
        expect.objectContaining({ targetId: s.id, metadata: { endReason: 'revoked' } }),
      ]);

      const own = await granted(tx, w);
      expect(
        (
          await revokeSession(
            { db: tx, userId: staffId, workspaceId: w.workspaceId },
            { sessionId: own.id },
          )
        ).status,
      ).toBe('ended');
      expect(
        await codeOf(
          revokeSession(
            { db: tx, userId: w.ownerId, workspaceId: w.workspaceId },
            { sessionId: own.id },
          ),
        ),
      ).toBe('CONFLICT');
    });
  });

  it('endStaffSupportSessions ends every open session of that staff member immediately', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const other = await seed(tx);
      const active = await granted(tx, w);
      const pending = await requested(tx, other);

      expect(await endStaffSupportSessions(tx, staffId)).toBeGreaterThanOrEqual(2);
      expect((await sessionRow(tx, active)).status).toBe('ended');
      expect((await sessionRow(tx, pending)).status).toBe('ended');
      await expect(
        assertActiveSupportSession(staffId, w.workspaceId, { db: tx }),
      ).rejects.toBeInstanceOf(SupportSessionInactiveError);
      expect(await audits(tx, w.workspaceId, 'support.session_ended')).toEqual([
        expect.objectContaining({ targetId: active.id, metadata: { endReason: 'staff_disabled' } }),
      ]);
      // A pending request was never a session: no end event.
      expect(await audits(tx, other.workspaceId, 'support.session_ended')).toEqual([]);
    });
  });
});

describe('the read-only support context', () => {
  it('serves reads only inside a granted view session and audits each with its target ids', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      await expect(
        withSupportSession({ db: tx, staffUserId: staffId }, w.workspaceId),
      ).rejects.toBeInstanceOf(SupportSessionInactiveError);

      const s = await granted(tx, w);
      const ctx = await withSupportSession({ db: tx, staffUserId: staffId }, w.workspaceId);
      expect(ctx.supportSession.supportSession.id).toBe(s.id);
      expect(ctx.supportSession.actor).toMatchObject({ kind: 'staff', userId: staffId });

      const matterIds = [randomUUID(), randomUUID()];
      const members = await ctx.supportSession.read(
        'matter.read',
        matterIds.map((id) => ({ kind: 'matter', id })),
        (q) => q.select({ userId: schema.member.userId }).from(schema.member),
      );
      expect(members.map((m) => m.userId).sort()).toEqual([w.ownerId, w.advocateId].sort());

      expect(await audits(tx, w.workspaceId, 'support.view')).toEqual([
        {
          actorUserId: staffId,
          actorKind: 'staff',
          targetKind: 'matter',
          targetId: matterIds[0],
          outcome: 'success',
          metadata: {
            supportSessionId: s.id,
            readAction: 'matter.read',
            targetKinds: 'matter',
            targetIds: matterIds.join(','),
          },
        },
      ]);
    });
  });

  it('denies every write through can() and audits it as denied', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const s = await granted(tx, w);
      const { supportSession } = await withSupportSession(
        { db: tx, staffUserId: staffId },
        w.workspaceId,
      );
      for (const action of ['matter.write', 'document.write', 'member.remove'] as const) {
        const error: unknown = await supportSession.assertCan(action).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(isForbiddenError(error)).toBe(true);
        expect(error).toMatchObject({ action, reason: 'STAFF_READ_ONLY' });
      }
      // A write action passed to read() is refused the same way.
      await expect(
        supportSession.read(
          'matter.write' as 'matter.read',
          [{ kind: 'matter', id: randomUUID() }],
          () => Promise.resolve(1),
        ),
      ).rejects.toMatchObject({ reason: 'STAFF_READ_ONLY' });

      const denied = await audits(tx, w.workspaceId, 'access.denied');
      expect(denied).toHaveLength(4);
      for (const row of denied) {
        expect(row).toMatchObject({
          actorUserId: staffId,
          actorKind: 'staff',
          outcome: 'denied',
          metadata: expect.objectContaining({
            reason: 'STAFF_READ_ONLY',
            supportSessionId: s.id,
          }) as unknown,
        });
      }
      expect(await audits(tx, w.workspaceId, 'support.view')).toEqual([]);
    });
  });

  it('discards anything a read callback writes', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      await granted(tx, w);
      const { supportSession } = await withSupportSession(
        { db: tx, staffUserId: staffId },
        w.workspaceId,
      );
      const matterId = randomUUID();
      await supportSession.read('matter.read', [{ kind: 'matter', id: matterId }], async (q) => {
        await q
          .insert(schema.matterRestriction)
          .values({ workspaceId: w.workspaceId, matterId, createdBy: w.ownerId });
        return null;
      });
      const rows = await inWorkspace(tx, w.workspaceId, (q) =>
        q
          .select()
          .from(schema.matterRestriction)
          .where(eq(schema.matterRestriction.matterId, matterId)),
      );
      expect(rows).toEqual([]);
    });
  });

  it('stops serving once the session is revoked or expires, and never serves metadata sessions', async () => {
    await withTestDb(async (tx) => {
      const w = await seed(tx);
      const s = await granted(tx, w);
      const { supportSession } = await withSupportSession(
        { db: tx, staffUserId: staffId },
        w.workspaceId,
      );
      const target = [{ kind: 'matter', id: randomUUID() }];
      await revokeSession(
        { db: tx, userId: w.ownerId, workspaceId: w.workspaceId },
        { sessionId: s.id },
      );
      await expect(
        supportSession.read('matter.read', target, () => Promise.resolve(1)),
      ).rejects.toBeInstanceOf(SupportSessionInactiveError);

      await granted(tx, w, 60, 'metadata');
      const meta = await withSupportSession({ db: tx, staffUserId: staffId }, w.workspaceId);
      expect(
        await codeOf(meta.supportSession.read('matter.read', target, () => Promise.resolve(1))),
      ).toBe('FORBIDDEN');
      expect(await audits(tx, w.workspaceId, 'access.denied')).toEqual([
        expect.objectContaining({
          actorKind: 'staff',
          metadata: expect.objectContaining({ reason: 'SUPPORT_SCOPE_METADATA' }) as unknown,
        }),
      ]);
      expect(await audits(tx, w.workspaceId, 'support.view')).toEqual([]);
    });
  });
});
