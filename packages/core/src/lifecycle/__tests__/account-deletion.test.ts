// Account deletion (#303). A sole owner is refused with a message naming the workspace and nothing
// is deleted; any other user loses their profile, sessions, logins, passkeys, two-factor and
// memberships, their audit events keep a salted `actor_ref` with `actor_user_id` null, and every
// chain still verifies. Workspace data they created (files, restrictions, flag overrides) stays
// with the workspace. Each test runs in one rolled-back transaction on the app role.
import { randomUUID } from 'node:crypto';

import { schema, withUser, withWorkspace, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { record, verifyChain } from '../../audit/index.ts';
import {
  ACCOUNT_DELETION_SOLE_OWNER_MESSAGE,
  requestAccountDeletion,
  runAccountDeletion,
} from '../index.ts';

import { captureLog } from './fixtures.ts';

const { account, blob, deletionJob, matterRestriction, member, passkey, session, twoFactor, user } =
  schema;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

async function newUser(tx: Transaction, label: string): Promise<string> {
  const [row] = await tx
    .insert(user)
    .values({ name: `User ${label}`, email: `${label}-${randomUUID()}@example.test` })
    .returning({ id: user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

/** Sign-in state for `userId`: a session, a login, a passkey and two-factor. */
async function signInState(tx: Transaction, userId: string): Promise<void> {
  await tx.insert(session).values({
    userId,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await tx.insert(account).values({ userId, accountId: userId, providerId: 'magic-link' });
  await tx.insert(passkey).values({
    userId,
    publicKey: 'pk',
    credentialID: randomUUID(),
    counter: 0,
    deviceType: 'singleDevice',
    backedUp: false,
  });
  await tx.insert(twoFactor).values({ userId, secret: 's', backupCodes: 'b' });
}

async function countFor(tx: Transaction, userId: string) {
  const [row] = await tx.execute<Record<string, number>>(sql`
    select (select count(*)::int from "user" where id = ${userId}) as "user",
           (select count(*)::int from session where user_id = ${userId}) as session,
           (select count(*)::int from account where user_id = ${userId}) as account,
           (select count(*)::int from passkey where user_id = ${userId}) as passkey,
           (select count(*)::int from two_factor where user_id = ${userId}) as two_factor`);
  return row;
}

async function membershipsOf(tx: Transaction, userId: string): Promise<number> {
  const rows = await withUser(tx, { userId }, (s) =>
    s.select({ id: member.id }).from(member).where(eq(member.userId, userId)),
  );
  return rows.length;
}

const accountChain = (tx: Transaction, from: Date) =>
  tx.execute<{ id: string | null; reason: string | null }>(
    sql`select id::text, reason from app_audit_verify_account_chain(${from.toISOString()}::timestamptz, null)`,
  );

const auditCtx = (tx: Transaction, workspaceId: string | null, userId: string) => ({
  db: tx,
  workspaceId,
  actor: { userId, kind: 'user' as const },
});

/** Add `userId` to workspace `ws` as `role`, with a file, a restriction and a flag override. */
async function joinWithData(tx: Transaction, ws: string, userId: string, role: string) {
  return withWorkspace(tx, { workspaceId: ws }, async (s) => {
    await s.insert(member).values({ organizationId: ws, userId, role });
    const blobId = randomUUID();
    await s.insert(blob).values({
      id: blobId,
      workspaceId: ws,
      key: `ws/${ws}/document/2026/${blobId}`,
      kind: 'document',
      filename: 'brief.pdf',
      size: 10,
      sha256: 'a'.repeat(64),
      mime: 'application/pdf',
      createdBy: userId,
    });
    const [restriction] = await s
      .insert(matterRestriction)
      .values({
        workspaceId: ws,
        matterId: randomUUID(),
        allowedUserIds: [userId],
        createdBy: userId,
      })
      .returning({ id: matterRestriction.id });
    await s.insert(schema.workspaceFeatureFlag).values({
      workspaceId: ws,
      key: `test.account_${randomUUID().replaceAll('-', '')}`,
      enabled: true,
      updatedBy: userId,
    });
    await record(auditCtx(s, ws, userId), { action: 'workspace.settings_viewed' });
    return { blobId, restrictionId: restriction?.id ?? '' };
  });
}

describe('requestAccountDeletion', () => {
  it('refuses a sole owner with a message naming the workspace, and deletes nothing', async () => {
    await withTestDb(async (tx) => {
      const seeded: TwoTenants = await seedTwoTenants(tx);
      const enqueue = vi.fn(() => Promise.resolve(null));
      let message = '';
      try {
        await requestAccountDeletion({ db: tx, userId: seeded.ua }, { enqueue });
      } catch (error) {
        expect((error as { code?: string }).code).toBe('CONFLICT');
        message = (error as Error).message;
      }
      expect(message).toContain(ACCOUNT_DELETION_SOLE_OWNER_MESSAGE);
      expect(message).toContain(seeded.a.name);
      expect(enqueue).not.toHaveBeenCalled();
      expect((await countFor(tx, seeded.ua))?.user).toBe(1);
      const jobs = await withUser(tx, { userId: seeded.ua }, (s) =>
        s.select().from(deletionJob).where(eq(deletionJob.userId, seeded.ua)),
      );
      expect(jobs).toEqual([]);
    });
  });

  it('schedules one job per user and enqueues it once', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const enqueue = vi.fn(() => Promise.resolve(null));
      const first = await requestAccountDeletion({ db: tx, userId: seeded.uboth }, { enqueue });
      const again = await requestAccountDeletion({ db: tx, userId: seeded.uboth }, { enqueue });
      expect(first.status).toBe('scheduled');
      expect(again.id).toBe(first.id);
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith({ userId: seeded.uboth, jobId: first.id });
      // Another user cannot see it (account_self).
      const visible = await withUser(tx, { userId: seeded.ua }, (s) =>
        s.select().from(deletionJob).where(eq(deletionJob.id, first.id)),
      );
      expect(visible).toEqual([]);
    });
  });
});

describe('runAccountDeletion', () => {
  it('removes the account and anonymises its audit events without breaking any chain', async () => {
    await withTestDb(async (tx) => {
      const start = new Date(Date.now() - 1000);
      const seeded = await seedTwoTenants(tx);
      const target = await newUser(tx, 'leaver');
      await signInState(tx, target);
      // A co-owner of A and an advocate of B: not the sole owner anywhere.
      const inA = await joinWithData(tx, seeded.a.id, target, 'owner');
      await joinWithData(tx, seeded.b.id, target, 'advocate');
      await withUser(tx, { userId: target }, (s) =>
        record(auditCtx(s, null, target), { action: 'account.profile_updated' }),
      );

      const { log } = captureLog();
      const job = await requestAccountDeletion(
        { db: tx, userId: target },
        { enqueue: () => Promise.resolve(null) },
      );
      const outcome = await runAccountDeletion({ db: tx, log }, { userId: target, jobId: job.id });
      expect(outcome.status).toBe('erased');
      // Two workspace events, the profile event and the deletion request.
      expect(outcome.anonymised).toBe(4);

      expect(await countFor(tx, target)).toEqual({
        user: 0,
        session: 0,
        account: 0,
        passkey: 0,
        two_factor: 0,
      });
      expect(await membershipsOf(tx, target)).toBe(0);

      for (const ws of [seeded.a.id, seeded.b.id]) {
        const rows = await withWorkspace(tx, { workspaceId: ws }, (s) =>
          s.execute<{ n: number }>(
            sql`select count(*)::int as n from audit_event
                where actor_user_id = ${target} or (actor_user_id is null and actor_ref is null and actor_kind = 'user')`,
          ),
        );
        expect(rows[0]?.n).toBe(0);
        expect(await verifyChain(tx, ws, { from: start })).toMatchObject({ ok: true });
      }
      expect(await accountChain(tx, start)).toEqual([{ id: null, reason: null }]);

      await withWorkspace(tx, { workspaceId: seeded.a.id }, async (s) => {
        const [file] = await s
          .select({ createdBy: blob.createdBy })
          .from(blob)
          .where(eq(blob.id, inA.blobId));
        expect(file).toEqual({ createdBy: null });
        const [restriction] = await s
          .select({
            createdBy: matterRestriction.createdBy,
            allowed: matterRestriction.allowedUserIds,
          })
          .from(matterRestriction)
          .where(eq(matterRestriction.id, inA.restrictionId));
        expect(restriction).toEqual({ createdBy: null, allowed: [] });
        const flags = await s
          .select({ key: schema.workspaceFeatureFlag.key })
          .from(schema.workspaceFeatureFlag)
          .where(
            and(
              eq(schema.workspaceFeatureFlag.workspaceId, seeded.a.id),
              sql`${schema.workspaceFeatureFlag.key} like 'test.account_%'`,
              sql`${schema.workspaceFeatureFlag.updatedBy} is null`,
            ),
          );
        expect(flags).toHaveLength(1);
      });

      const [row] = await withUser(tx, { userId: target }, (s) =>
        s.select().from(deletionJob).where(eq(deletionJob.id, job.id)),
      );
      expect(row?.status).toBe('erased');
      expect(row?.completedAt).not.toBeNull();

      // Rerunning is a no-op.
      expect(
        await runAccountDeletion({ db: tx, log }, { userId: target, jobId: job.id }),
      ).toMatchObject({ status: 'already-erased' });
    });
  });

  it('fails the job when the user became the sole owner before it ran', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const target = await newUser(tx, 'late');
      await withWorkspace(tx, { workspaceId: seeded.a.id }, (s) =>
        s.insert(member).values({ organizationId: seeded.a.id, userId: target, role: 'owner' }),
      );
      const job = await requestAccountDeletion(
        { db: tx, userId: target },
        { enqueue: () => Promise.resolve(null) },
      );
      // The other owner leaves before the job runs.
      await withWorkspace(tx, { workspaceId: seeded.a.id }, (s) =>
        s
          .update(member)
          .set({ status: 'removed' })
          .where(and(eq(member.organizationId, seeded.a.id), eq(member.userId, seeded.ua))),
      );
      const { log } = captureLog();
      const outcome = await runAccountDeletion({ db: tx, log }, { userId: target, jobId: job.id });
      expect(outcome).toMatchObject({ status: 'failed', error: 'sole_owner' });
      expect((await countFor(tx, target))?.user).toBe(1);
      expect(
        await codeOf(requestAccountDeletion({ db: tx, userId: target }, { enqueue: vi.fn() })),
      ).toBe('CONFLICT');
    });
  });

  it("does not touch another user's account or audit attribution", async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      await withWorkspace(tx, { workspaceId: seeded.a.id }, (s) =>
        record(auditCtx(s, seeded.a.id, seeded.ua), { action: 'workspace.settings_viewed' }),
      );
      const { log } = captureLog();
      const job = await requestAccountDeletion(
        { db: tx, userId: seeded.uboth },
        { enqueue: () => Promise.resolve(null) },
      );
      // A job id belonging to uboth cannot be run for ua.
      expect(
        await runAccountDeletion({ db: tx, log }, { userId: seeded.ua, jobId: job.id }),
      ).toMatchObject({ status: 'missing' });
      await runAccountDeletion({ db: tx, log }, { userId: seeded.uboth, jobId: job.id });
      expect((await countFor(tx, seeded.ua))?.user).toBe(1);
      const [own] = await withWorkspace(tx, { workspaceId: seeded.a.id }, (s) =>
        s.execute<{ n: number }>(
          sql`select count(*)::int as n from audit_event where actor_user_id = ${seeded.ua}`,
        ),
      );
      expect(own?.n).toBeGreaterThan(0);
    });
  });
});
