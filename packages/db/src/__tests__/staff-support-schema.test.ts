// staff_user and support_session (#308): staff rows are writable only by the owner role (the
// operator CLI), support_session is a tenant table under FORCE RLS whose `staff_self` policy shows
// an enabled staff member their own sessions from a user scope, a grant lasts at most 4 h, and the
// owner-defined sweeps expire elapsed grants and end a disabled staff member's sessions.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database, type Transaction } from '../client.ts';
import { registeredTenantTables } from '../rls-policies.ts';
import { withUser } from '../rls.ts';
import { user } from '../schema/auth.ts';
import { staffUser, supportSession } from '../schema/staff.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

let owner: Database;
let staffId: string;
let disabledStaffId: string;

async function committedUser(db: Database): Promise<string> {
  const [row] = await db
    .insert(user)
    .values({ name: 'Staff', email: `${randomUUID()}@staff.test` })
    .returning({ id: user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

beforeAll(async () => {
  owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });
  staffId = await committedUser(owner);
  disabledStaffId = await committedUser(owner);
  await owner.insert(staffUser).values([
    { userId: staffId, role: 'support' },
    { userId: disabledStaffId, role: 'support', disabledAt: new Date() },
  ]);
});

afterAll(async () => {
  // Deleting the users cascades to staff_user.
  await owner.execute(sql`delete from "user" where id in (${staffId}, ${disabledStaffId})`);
  await owner.$client.end();
});

/** A granted session in `workspaceId`, `minutesAgo` granted and lasting `minutes`. */
async function grantedSession(
  tx: Transaction,
  workspaceId: string,
  requestedByStaff: string,
  { minutesAgo = 0, minutes = 60 } = {},
): Promise<string> {
  return inWorkspace(tx, workspaceId, async (s) => {
    const grantedAt = sql`now() - make_interval(mins => ${minutesAgo})`;
    const [row] = await s
      .insert(supportSession)
      .values({
        workspaceId,
        requestedByStaff,
        reason: 'Customer asked for help',
        scope: 'view',
        status: 'granted',
        grantedAt,
        expiresAt: sql`${grantedAt} + make_interval(mins => ${minutes})`,
      })
      .returning({ id: supportSession.id });
    if (!row) throw new Error('support_session insert failed');
    return row.id;
  });
}

describe('staff_user', () => {
  it('is readable but never writable by the app role', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx
        .select()
        .from(staffUser)
        .where(sql`user_id = ${staffId}`);
      expect(rows).toHaveLength(1);
      const someone = randomUUID();
      expect(
        await sqlState(
          tx.transaction((sp) => sp.insert(staffUser).values({ userId: someone, role: 'admin' })),
        ),
      ).toBe('42501');
      expect(
        await sqlState(
          tx.transaction((sp) => sp.execute(sql`update staff_user set role = 'admin'`)),
        ),
      ).toBe('42501');
      expect(await sqlState(tx.transaction((sp) => sp.execute(sql`delete from staff_user`)))).toBe(
        '42501',
      );
    });
  });
});

describe('support_session', () => {
  it('is a tenant table under FORCE RLS with ws_isolation, staff_self and owner sweeps', async () => {
    expect(registeredTenantTables()).toContain('support_session');
    await withTestDb(async (tx) => {
      const [row] = await tx.execute<{ enabled: boolean; forced: boolean; policies: string[] }>(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies
          from pg_class c where c.relname = 'support_session'`);
      expect(row).toEqual({
        enabled: true,
        forced: true,
        policies: ['owner_definer_read', 'owner_definer_sweep', 'staff_self', 'ws_isolation'],
      });
    });
  });

  it('rejects a grant longer than 4 h, a granted row without a window, and a blank reason', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      expect(
        await sqlState(
          tx.transaction((sp) => grantedSession(sp, ws.id, staffId, { minutes: 241 })),
        ),
      ).toBe('23514');
      expect(await grantedSession(tx, ws.id, staffId, { minutes: 240 })).toBeTypeOf('string');
      await inWorkspace(tx, ws.id, async (s) => {
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(supportSession).values({
                workspaceId: ws.id,
                requestedByStaff: staffId,
                reason: 'x',
                status: 'granted',
              }),
            ),
          ),
        ).toBe('23514');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(supportSession)
                .values({ workspaceId: ws.id, requestedByStaff: staffId, reason: '   ' }),
            ),
          ),
        ).toBe('23514');
      });
    });
  });

  it('staff_self shows enabled staff only their own sessions, and only without a workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const mine = await grantedSession(tx, a.id, staffId);
      const theirs = await grantedSession(tx, b.id, disabledStaffId);
      const outsider = a.userIds[0] ?? '';

      const visible = (userId: string) =>
        withUser(tx, { userId }, (s) => s.select({ id: supportSession.id }).from(supportSession));
      expect((await visible(staffId)).map((r) => r.id)).toEqual([mine]);
      // Disabled staff see nothing, not even their own; a plain user sees nothing.
      expect(await visible(disabledStaffId)).toEqual([]);
      expect(await visible(outsider)).toEqual([]);
      // Inside another workspace's scope, ws_isolation alone applies.
      await inWorkspace(
        tx,
        b.id,
        async (s) => {
          const ids = (await s.select({ id: supportSession.id }).from(supportSession)).map(
            (r) => r.id,
          );
          expect(ids).toEqual([theirs]);
        },
        staffId,
      );
    });
  });

  it('app_expire_support_sessions expires only elapsed grants and returns their ids', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const elapsed = await grantedSession(tx, ws.id, staffId, { minutesAgo: 90, minutes: 60 });
      const live = await grantedSession(tx, ws.id, staffId, { minutesAgo: 10, minutes: 60 });
      const rows = await tx.execute<{ id: string; workspace_id: string }>(
        sql`select id, workspace_id from app_expire_support_sessions()`,
      );
      expect(rows.map((r) => r.id)).toContain(elapsed);
      expect(rows.map((r) => r.id)).not.toContain(live);
      await inWorkspace(tx, ws.id, async (s) => {
        const statuses = await s
          .select({ id: supportSession.id, status: supportSession.status })
          .from(supportSession);
        expect(Object.fromEntries(statuses.map((r) => [r.id, r.status]))).toEqual({
          [elapsed]: 'expired',
          [live]: 'granted',
        });
      });
    });
  });

  it('app_end_staff_support_sessions ends one staff member’s open sessions everywhere', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const granted = await grantedSession(tx, a.id, staffId);
      const requested = await inWorkspace(tx, b.id, async (s) => {
        const [row] = await s
          .insert(supportSession)
          .values({ workspaceId: b.id, requestedByStaff: staffId, reason: 'Please' })
          .returning({ id: supportSession.id });
        return row?.id ?? '';
      });
      const other = await grantedSession(tx, b.id, disabledStaffId);

      const rows = await tx.execute<{ id: string; was_granted: boolean }>(
        sql`select id, was_granted from app_end_staff_support_sessions(${staffId}::uuid)`,
      );
      expect(Object.fromEntries(rows.map((r) => [r.id, r.was_granted]))).toEqual({
        [granted]: true,
        [requested]: false,
      });
      await inWorkspace(tx, b.id, async (s) => {
        const statuses = await s
          .select({ id: supportSession.id, status: supportSession.status })
          .from(supportSession);
        expect(Object.fromEntries(statuses.map((r) => [r.id, r.status]))).toEqual({
          [requested]: 'ended',
          [other]: 'granted',
        });
      });
    });
  });
});
