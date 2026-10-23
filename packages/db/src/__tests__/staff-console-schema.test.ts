// Staff console reads (#310, migration 0033): the owner-defined workspace metadata and staff audit
// functions run only for an enabled staff member (app.user_id), are not executable by PUBLIC, and
// return the listed metadata columns only; owner_definer_read on member and workspace_feature_flag
// is for the owner role alone. The usage functions of 0035 (#224) follow the same rules, and
// budget_override's early-expiry columns are all set or none.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database, type Transaction } from '../client.ts';
import { withUser } from '../rls.ts';
import { user } from '../schema/auth.ts';
import { usageCounter } from '../schema/billing.ts';
import { workspaceFeatureFlag } from '../schema/flags.ts';
import { staffUser } from '../schema/staff.ts';
import { budgetOverride } from '../schema/usage.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { seedTwoTenants } from '../testing/two-tenants.ts';
import { sqlState } from './rls/fixtures.ts';

const WORKSPACE_COLUMNS = [
  'clerk_seats',
  'created_at',
  'deleted_at',
  'flags',
  'kind',
  'last_active_at',
  'member_count',
  'name',
  'owner_email',
  'plan_id',
  'seats',
  'slug',
  'storage_bytes',
  'workspace_id',
];
const AUDIT_COLUMNS = [
  'action',
  'actor_user_id',
  'created_at',
  'id',
  'outcome',
  'session_id',
  'workspace_id',
];
const FUNCTIONS = [
  'app_staff_workspace_search(text,integer)',
  'app_staff_workspace_metadata(uuid)',
  'app_staff_audit_events(timestamp with time zone,uuid,integer)',
  'app_staff_workspace_usage(uuid)',
  'app_staff_budget_overrides(uuid,integer)',
  'app_staff_parse_yield(timestamp with time zone)',
];
const COUNTER_COLUMNS = ['key', 'period_start', 'value'];
const OVERRIDE_COLUMNS = [
  'created_at',
  'expire_reason',
  'expired_at',
  'expired_by',
  'expires_at',
  'id',
  'key',
  'limit_value',
  'reason',
  'set_by',
];

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
  await owner.execute(sql`delete from "user" where id in (${staffId}, ${disabledStaffId})`);
  await owner.$client.end();
});

function as<T>(tx: Transaction, userId: string, fn: (s: Transaction) => Promise<T>): Promise<T> {
  return withUser(tx, { userId }, fn);
}

describe('staff parse yield (0067)', () => {
  it('returns per-adapter counts only, summed across workspaces, to an enabled staff member', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const adapterId = `parse-yield-${t.a.id.slice(0, 8)}`;
      await tx.execute(
        sql`insert into adapter_parse_run (workspace_id, document_id, adapter_id, adapter_version, forum_code, rows_parsed, rows_anchored, unmapped_headings, unknown_case_types, status)
            select w, gen_random_uuid(), ${adapterId}, '1', 'f', 10, 8, 0, 0, 'ok' from unnest(array[${t.a.id}::uuid, ${t.b.id}::uuid]) as w`,
      );
      const rows = await as(tx, staffId, (s) =>
        s.execute(
          sql`select * from app_staff_parse_yield(now() - interval '1 day') where adapter_id = ${adapterId}`,
        ),
      );
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
        'adapter_id',
        'rows_anchored',
        'rows_parsed',
        'runs',
      ]);
      expect(rows[0]).toMatchObject({ runs: '2', rows_parsed: '20', rows_anchored: '16' });
    });
  });
});

describe('staff console functions (0033)', () => {
  it('refuse anyone but an enabled staff member, and are not executable by PUBLIC', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const calls = [
        sql`select * from app_staff_workspace_search(${t.a.slug}, 10)`,
        sql`select * from app_staff_workspace_metadata(${t.a.id}::uuid)`,
        sql`select * from app_staff_audit_events(null, null, 10)`,
        sql`select * from app_staff_workspace_usage(${t.a.id}::uuid)`,
        sql`select * from app_staff_budget_overrides(${t.a.id}::uuid, 10)`,
        sql`select * from app_staff_parse_yield(now() - interval '7 days')`,
      ];
      for (const call of calls) {
        for (const userId of [t.ua, disabledStaffId]) {
          expect(await sqlState(as(tx, userId, (s) => s.execute(call)))).toBe('42501');
        }
        // No user pinned at all.
        expect(await sqlState(tx.transaction((s) => s.execute(call)))).toBe('42501');
      }
      const grants = await tx.execute<{ fn: string; pub: boolean; app: boolean; clerk: boolean }>(
        sql`select p.oid::regprocedure::text as fn,
                   has_function_privilege('public', p.oid, 'execute') as pub,
                   has_function_privilege('causedeck_app', p.oid, 'execute') as app,
                   has_function_privilege('causedeck_clerk', p.oid, 'execute') as clerk
              from pg_proc p where p.proname like 'app_staff_%' order by 1`,
      );
      const byName = Object.fromEntries(grants.map((g) => [g.fn, g]));
      for (const fn of FUNCTIONS) {
        expect(byName[fn], fn).toMatchObject({ pub: false, app: true, clerk: true });
      }
      // The helpers are reachable only from inside the definer functions.
      expect(byName['app_staff_require_caller()']).toMatchObject({ pub: false, app: false });
      expect(byName['app_staff_workspace_rows(uuid[])']).toMatchObject({ pub: false, app: false });
    });
  });

  it('find a workspace by slug prefix and by owner email, with metadata columns only', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      await inWorkspace(tx, t.a.id, (s) =>
        s
          .insert(workspaceFeatureFlag)
          .values({ workspaceId: t.a.id, key: 'drafts.beta', enabled: true }),
      );
      const [ownerRow] = await tx
        .select({ email: user.email })
        .from(user)
        .where(sql`id = ${t.ua}`);
      const bySlug = await as(tx, staffId, (s) =>
        s.execute(
          sql`select * from app_staff_workspace_search(${t.a.slug.toUpperCase().slice(0, -2)}, 50)`,
        ),
      );
      expect(bySlug.map((r) => r.workspace_id)).toContain(t.a.id);
      expect(Object.keys(bySlug[0] ?? {}).sort()).toEqual(WORKSPACE_COLUMNS);

      const byEmail = await as(tx, staffId, (s) =>
        s.execute(sql`select * from app_staff_workspace_search(${ownerRow?.email ?? ''}, 50)`),
      );
      expect(byEmail.map((r) => r.workspace_id)).toEqual([t.a.id]);
      const row = byEmail[0] ?? {};
      expect(row).toMatchObject({
        slug: t.a.slug,
        owner_email: ownerRow?.email,
        member_count: 3, // owner, uboth and the seeded viewer
        seats: 1,
        clerk_seats: 0,
      });
      expect(row.last_active_at).not.toBeNull();
      const flags: unknown = typeof row.flags === 'string' ? JSON.parse(row.flags) : row.flags;
      expect(flags).toContainEqual({ key: 'drafts.beta', enabled: true });

      // LIKE wildcards in the query are literal.
      const wild = await as(tx, staffId, (s) =>
        s.execute(sql`select * from app_staff_workspace_search('%', 50)`),
      );
      expect(wild).toEqual([]);

      const one = await as(tx, staffId, (s) =>
        s.execute(sql`select * from app_staff_workspace_metadata(${t.b.id}::uuid)`),
      );
      expect(one.map((r) => r.workspace_id)).toEqual([t.b.id]);
      const none = await as(tx, staffId, (s) =>
        s.execute(sql`select * from app_staff_workspace_metadata(${randomUUID()}::uuid)`),
      );
      expect(none).toEqual([]);
    });
  });

  it('list staff actions only, with the session id and no metadata, IP or user agent', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const session = randomUUID();
      await inWorkspace(tx, t.a.id, (s) =>
        s.execute(sql`select app_audit_append(${t.a.id}::uuid, ${staffId}::uuid, 'staff',
          'support.view', 'matter', ${randomUUID()}, 'success', '203.0.113.9'::inet, 'ua-hash',
          null, jsonb_build_object('supportSessionId', ${session}::text, 'readAction', 'matter.read'))`),
      );
      const rows = await as(tx, staffId, (s) =>
        s.execute(sql`select * from app_staff_audit_events(null, null, 100)`),
      );
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(AUDIT_COLUMNS);
      const mine = rows.find((r) => r.session_id === session);
      expect(mine).toMatchObject({
        actor_user_id: staffId,
        action: 'support.view',
        workspace_id: t.a.id,
        session_id: session,
        outcome: 'success',
      });
      // The seeded user-kind events are not staff actions.
      expect(rows.some((r) => r.action === 'xt.seed')).toBe(false);
      // Older than the newest one: it is excluded.
      const older = await as(tx, staffId, (s) =>
        s.execute<{ id: string }>(
          sql`select * from app_staff_audit_events(now(), ${String(mine?.id)}::uuid, 100)`,
        ),
      );
      expect(older.map((r) => r.id)).not.toContain(mine?.id);
    });
  });

  it('owner_definer_read on member and workspace_feature_flag is for the owner only', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ table: string; roles: string }>(
        sql`select tablename::text as table, roles::text as roles from pg_policies
             where policyname = 'owner_definer_read'
               and tablename in ('member', 'workspace_feature_flag') order by 1`,
      );
      expect(rows).toEqual([
        { table: 'member', roles: '{causedeck_owner}' },
        { table: 'workspace_feature_flag', roles: '{causedeck_owner}' },
      ]);
      // The app role still sees no other workspace's members without a scope.
      const t = await seedTwoTenants(tx);
      const seen = await tx.execute(sql`select 1 from member where workspace_id = ${t.a.id}::uuid`);
      expect(seen).toEqual([]);
    });
  });

  it('owner_definer_read on budget_override is for the owner only (0035)', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ roles: string }>(
        sql`select roles::text as roles from pg_policies
             where policyname = 'owner_definer_read' and tablename = 'budget_override'`,
      );
      expect(rows).toEqual([{ roles: '{causedeck_owner}' }]);
      const t = await seedTwoTenants(tx);
      const seen = await tx.execute(
        sql`select 1 from budget_override where workspace_id = ${t.a.id}::uuid`,
      );
      expect(seen).toEqual([]);
    });
  });
});

describe('staff workspace usage functions (0035, #224)', () => {
  it("return the workspace's newest counter per key, with the listed columns only", async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const older = new Date('2026-08-31T18:30:00.000Z');
      const newer = new Date('2026-09-30T18:30:00.000Z');
      await inWorkspace(tx, t.a.id, (s) =>
        s.insert(usageCounter).values([
          { workspaceId: t.a.id, key: 'ai.spend_paise', periodStart: older, value: 900 },
          { workspaceId: t.a.id, key: 'ai.spend_paise', periodStart: newer, value: 120 },
        ]),
      );
      await inWorkspace(tx, t.b.id, (s) =>
        s
          .insert(usageCounter)
          .values({ workspaceId: t.b.id, key: 'ai.spend_paise', periodStart: newer, value: 7 }),
      );
      const rows = await as(tx, staffId, (s) =>
        s.execute<{ key: string; period_start: string | Date; value: string | number }>(
          sql`select * from app_staff_workspace_usage(${t.a.id}::uuid)`,
        ),
      );
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(COUNTER_COLUMNS);
      const spend = rows.filter((r) => r.key === 'ai.spend_paise');
      expect(spend).toHaveLength(1);
      expect(Number(spend[0]?.value)).toBe(120);
      expect(new Date(spend[0]?.period_start ?? 0).toISOString()).toBe(newer.toISOString());
      // A's seeded counter is there too; B's value is not.
      expect(rows.length).toBeGreaterThan(1);
      expect(rows.some((r) => Number(r.value) === 7)).toBe(false);
    });
  });

  it("return the workspace's overrides newest first, capped by max", async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const day = 86_400_000;
      await inWorkspace(tx, t.a.id, (s) =>
        s.insert(budgetOverride).values(
          [1, 2, 3].map((n) => ({
            workspaceId: t.a.id,
            key: 'ai.spend_paise',
            limitValue: n * 1000,
            setBy: t.ua,
            reason: `step ${String(n)}`,
            expiresAt: new Date(Date.now() + day),
            createdAt: new Date(Date.now() - (10 - n) * 60_000),
          })),
        ),
      );
      const all = await as(tx, staffId, (s) =>
        s.execute<{ reason: string }>(
          sql`select * from app_staff_budget_overrides(${t.a.id}::uuid, 50)`,
        ),
      );
      expect(Object.keys(all[0] ?? {}).sort()).toEqual(OVERRIDE_COLUMNS);
      // Newest first (the cross-tenant seed row, created now, comes before them).
      expect(all.map((r) => r.reason).filter((r) => r.startsWith('step'))).toEqual([
        'step 3',
        'step 2',
        'step 1',
      ]);
      expect(all).toHaveLength(4);
      const two = await as(tx, staffId, (s) =>
        s.execute(sql`select * from app_staff_budget_overrides(${t.a.id}::uuid, 2)`),
      );
      expect(two).toHaveLength(2);
      const bRows = await as(tx, staffId, (s) =>
        s.execute<{ reason: string }>(
          sql`select * from app_staff_budget_overrides(${t.b.id}::uuid, 50)`,
        ),
      );
      expect(bRows.map((r) => r.reason)).not.toContain('step 1');
    });
  });

  it('budget_override_expiry_chk rejects partial or blank early-expiry columns', async () => {
    await withTestDb(async (tx) => {
      const t = await seedTwoTenants(tx);
      const base = {
        workspaceId: t.a.id,
        key: 'ai.spend_paise',
        limitValue: 1000,
        setBy: t.ua,
        reason: 'pilot',
        expiresAt: new Date(Date.now() + 86_400_000),
      };
      const now = new Date();
      for (const partial of [
        { expiredAt: now },
        { expiredAt: now, expiredBy: t.ua },
        { expiredAt: now, expiredBy: t.ua, expireReason: '   ' },
        { expireReason: 'done' },
      ]) {
        const error = await sqlState(
          inWorkspace(tx, t.a.id, (s) =>
            s.transaction((x) => x.insert(budgetOverride).values({ ...base, ...partial })),
          ),
        );
        expect(error, JSON.stringify(partial)).toBe('23514');
      }
      await inWorkspace(tx, t.a.id, (s) =>
        s
          .insert(budgetOverride)
          .values({ ...base, expiredAt: now, expiredBy: t.ua, expireReason: 'pilot ended' }),
      );
    });
  });
});
