// Audit immutability (#226, #26): `audit_event` and `ai_call` are append-only. The app role has no
// UPDATE, DELETE or TRUNCATE; a trigger rejects them for the owner too; only the retention purge
// functions (which refuse to cut into the last 180 days) delete rows.
import { randomUUID } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { sql, TransactionRollbackError, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { createOwnerDb } from '../owner.ts';
import { withWorkspace } from '../rls.ts';
import { inWorkspace, testDatabaseUrls, withTestDb } from '../testing/index.ts';
import { sqlState } from './rls/fixtures.ts';

const DENIED = '42501';
const INVALID_PARAMETER = '22023';
const TABLES = ['audit_event', 'ai_call'] as const;

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
afterAll(async () => {
  await owner.$client.end();
});

/** Run `fn` as the owner in a transaction that is always rolled back. */
async function asOwner(fn: (tx: Transaction) => Promise<void>): Promise<void> {
  const state = { done: false };
  try {
    await owner.transaction(async (tx) => {
      await fn(tx);
      state.done = true;
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError) || !state.done) throw error;
  }
}

/** One audit event (through the chain function) and one ai_call row in `workspaceId`. */
async function seed(tx: Transaction, workspaceId: string, createdAt?: Date): Promise<void> {
  await tx.execute(
    sql`select * from app_audit_append(${workspaceId}::uuid, null, 'system', 'test.seed')`,
  );
  await tx.execute(sql`
    insert into ai_call (workspace_id, purpose, provider, model, region, automation_level, created_at)
    values (${workspaceId}, 'test', 'mock', 'mock-1', 'ap-south-1', 1,
            ${(createdAt ?? new Date()).toISOString()}::timestamptz)`);
}

const mutations = (table: string): [string, SQL][] => [
  ['UPDATE', sql.raw(`update "${table}" set created_at = created_at`)],
  ['DELETE', sql.raw(`delete from "${table}"`)],
  ['TRUNCATE', sql.raw(`truncate "${table}"`)],
];

describe('audit tables as the application role', () => {
  it.each(TABLES)('%s: UPDATE, DELETE and TRUNCATE fail with permission errors', async (table) => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await inWorkspace(tx, workspaceId, async (scoped) => {
        await seed(scoped, workspaceId);
        for (const [, statement] of mutations(table)) {
          expect(await sqlState(scoped.transaction((sp) => sp.execute(statement)))).toBe(DENIED);
        }
        const [row] = await scoped.execute<{ n: number }>(
          sql.raw(`select count(*)::int as n from "${table}"`),
        );
        expect(row?.n).toBe(1);
      });
    });
  });

  it('has only SELECT and INSERT on the audit tables', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ table: string; privilege: string }>(sql`
        select table_name as table, privilege_type as privilege
        from information_schema.role_table_grants
        where grantee = 'causedeck_app' and table_name in ('audit_event', 'ai_call')
        order by 1, 2`);
      expect(rows).toEqual([
        { table: 'ai_call', privilege: 'INSERT' },
        { table: 'ai_call', privilege: 'SELECT' },
        { table: 'audit_event', privilege: 'INSERT' },
        { table: 'audit_event', privilege: 'SELECT' },
      ]);
    });
  });
});

describe('audit tables as the owner role', () => {
  it.each(TABLES)('%s: the trigger blocks UPDATE, DELETE and TRUNCATE', async (table) => {
    await asOwner(async (tx) => {
      const workspaceId = randomUUID();
      await withWorkspace(tx, { workspaceId }, async (scoped) => {
        await seed(scoped, workspaceId);
        for (const [op, statement] of mutations(table)) {
          const failure = await scoped
            .transaction((sp) => sp.execute(statement))
            .then(
              () => undefined,
              (e: unknown) => ((e as { cause?: Error }).cause ?? (e as Error)).message,
            );
          expect(failure, op).toBe(`${table} is append-only: ${op} is not allowed`);
        }
      });
    });
  });
});

describe('the retention path', () => {
  it('purges rows older than the cutoff, keeps younger ones and re-arms the trigger', async () => {
    await asOwner(async (tx) => {
      const workspaceId = randomUUID();
      const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
      await withWorkspace(tx, { workspaceId }, async (scoped) => {
        await seed(scoped, workspaceId);
        await seed(scoped, workspaceId, old);
        await scoped.execute(sql`
          insert into audit_event (workspace_id, actor_kind, action, prev_hash, hash, created_at)
          values (${workspaceId}, 'system', 'test.old', '\\x02'::bytea, '\\x00'::bytea, ${old.toISOString()}::timestamptz)`);
      });
      const cutoff = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
      const [audit] = await tx.execute<{ n: string }>(
        sql`select app_purge_audit(${cutoff}::timestamptz) as n`,
      );
      const [calls] = await tx.execute<{ n: string }>(
        sql`select app_purge_ai_calls(${cutoff}::timestamptz) as n`,
      );
      expect(Number(audit?.n)).toBeGreaterThanOrEqual(1);
      expect(Number(calls?.n)).toBeGreaterThanOrEqual(1);

      await withWorkspace(tx, { workspaceId }, async (scoped) => {
        // Two recent audit events (the seeds) and one recent ai_call survive.
        for (const [table, kept] of [
          ['audit_event', 2],
          ['ai_call', 1],
        ] as const) {
          const [row] = await scoped.execute<{ n: number }>(
            sql.raw(
              `select count(*)::int as n from "${table}" where workspace_id = '${workspaceId}'`,
            ),
          );
          expect(row?.n, table).toBe(kept);
        }
        const [setting] = await scoped.execute<{ v: string | null }>(
          sql`select current_setting('app.audit_retention', true) as v`,
        );
        expect(setting?.v ?? '').toBe('');
        expect(
          await sqlState(scoped.transaction((sp) => sp.execute(sql`delete from audit_event`))),
        ).toBe(DENIED);
      });
    });
  });

  it('is callable by the app role and refuses a cutoff inside the last 180 days', async () => {
    await withTestDb(async (tx) => {
      const recent = new Date(Date.now() - 179 * 24 * 60 * 60 * 1000).toISOString();
      for (const fn of ['app_purge_audit', 'app_purge_ai_calls']) {
        expect(
          await sqlState(
            tx.transaction((sp) => sp.execute(sql.raw(`select ${fn}('${recent}'::timestamptz)`))),
          ),
          fn,
        ).toBe(INVALID_PARAMETER);
      }
      const cutoff = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
      const [row] = await tx.execute<{ n: string }>(
        sql`select app_purge_audit(${cutoff}::timestamptz) as n`,
      );
      expect(Number(row?.n)).toBeGreaterThanOrEqual(0);
    });
  });
});
