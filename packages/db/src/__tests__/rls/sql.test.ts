// Catalog checks (#19): every tenant table is under ENABLE + FORCE RLS with `ws_isolation`,
// `db:check-rls` fails on a table without them and on cross-workspace foreign keys, and a table
// declared with `tenantTable()` gets its policies from `tenantPolicy()` in the same migration.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Secret } from '@causedeck/config/env';
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { getTableConfig, text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { checkMigrationPolicies, checkRls } from '../../check-rls.ts';
import type { Transaction } from '../../client.ts';
import { id } from '../../columns.ts';
import { GLOBAL_TABLES } from '../../conventions.ts';
import { runMigrations } from '../../migrate.ts';
import { createOwnerDb } from '../../owner.ts';
import {
  BASELINE_TENANT_TABLES,
  missingTenantPolicies,
  registeredTenantTables,
  tenantPolicy,
} from '../../rls-policies.ts';
import { tenantTable } from '../../schema-helpers/tenant-table.ts';
import { createScratchDatabase, testDatabaseUrls } from '../../testing/index.ts';
import { runCli } from '../run-cli.ts';

const PACKAGE_DIR = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATION = fileURLToPath(
  new URL('../../../migrations/0006_rls_baseline.sql', import.meta.url),
);

/** Tenant tables created after the baseline, with their policies in the same migration (#218). */
const USAGE_TABLES = [
  'usage_reservation',
  'usage_event',
  'budget_override',
  'usage_period_summary',
];

const owner = createOwnerDb(new Secret(testDatabaseUrls().owner));
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
afterAll(async () => {
  await owner.$client.end();
});

/** Run `fn` as the owner in a transaction that is always rolled back (DDL included). */
async function rolledBack<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  let result: { value: T } | undefined;
  try {
    await owner.transaction(async (tx) => {
      result = { value: await fn(tx) };
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError) || result === undefined) throw error;
  }
  if (result === undefined) throw new Error('rolledBack: no result');
  return result.value;
}

const rules = (violations: { table: string; rule: string }[]) =>
  violations.map((v) => `${v.table}:${v.rule}`).sort();

describe('row-level security catalog', () => {
  it('every table with workspace_id (outside GLOBAL_TABLES) has ENABLE, FORCE and ws_isolation', async () => {
    const rows = await owner.execute<{
      name: string;
      enabled: boolean;
      forced: boolean;
      policy: boolean;
    }>(sql`
      select c.relname::text as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             exists (select 1 from pg_policies p where p.tablename = c.relname
                     and p.policyname = 'ws_isolation' and p.cmd = 'ALL') as policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id')
        and not (c.relname = any(${sql.raw(`array[${GLOBAL_TABLES.map((t) => `'${t}'`).join(', ')}]`)}))
      order by 1`);
    // Baseline tables plus the tenant tables created after 0006 (#226, #194, #218, #22, #216, #252, #233, #217, #301).
    expect(rows.map((r) => r.name)).toEqual(
      [
        ...BASELINE_TENANT_TABLES,
        'audit_event',
        'ai_call',
        'notification',
        'notification_pref',
        'notification_setting',
        ...USAGE_TABLES,
        'workspace_feature_flag',
        'workspace_key',
        'saas_invoice',
        'saas_invoice_line',
        'matter_restriction',
        'blob',
        'export_job',
        'deletion_job',
      ].sort(),
    );
    for (const row of rows)
      expect(row, row.name).toMatchObject({ enabled: true, forced: true, policy: true });
    expect(await checkRls(owner)).toEqual([]);
  });

  it('keeps api_idempotency_key global (allow-listed, no RLS)', async () => {
    const [row] = await owner.execute<{ enabled: boolean }>(
      sql`select relrowsecurity as enabled from pg_class where relname = 'api_idempotency_key'`,
    );
    expect(row?.enabled).toBe(false);
    expect(GLOBAL_TABLES).toContain('api_idempotency_key');
  });

  it('flags a tenant table that lacks ENABLE, FORCE or the policy', async () => {
    const found = await rolledBack(async (tx) => {
      await tx.execute(
        sql`create table rls_fixture_bare (id uuid primary key, workspace_id uuid not null)`,
      );
      await tx.execute(
        sql`create table rls_fixture_enabled (id uuid primary key, workspace_id uuid not null)`,
      );
      await tx.execute(sql`alter table rls_fixture_enabled enable row level security`);
      return checkRls(tx);
    });
    expect(rules(found)).toEqual([
      'rls_fixture_bare:missing-ws-isolation',
      'rls_fixture_bare:rls-not-enabled',
      'rls_fixture_bare:rls-not-forced',
      'rls_fixture_enabled:missing-ws-isolation',
      'rls_fixture_enabled:rls-not-forced',
    ]);
  });

  it('flags a foreign key to a tenant table that does not pair workspace_id', async () => {
    const found = await rolledBack(async (tx) => {
      await tx.execute(sql`create table rls_fixture_parent (
        id uuid primary key, workspace_id uuid not null, unique (workspace_id, id))`);
      await tx.execute(sql`create table rls_fixture_child (
        id uuid primary key, workspace_id uuid not null,
        parent_id uuid references rls_fixture_parent (id),
        member_id uuid references member (id),
        foreign key (workspace_id, parent_id) references rls_fixture_parent (workspace_id, id))`);
      for (const t of ['rls_fixture_parent', 'rls_fixture_child']) {
        for (const statement of tenantPolicy(t)) await tx.execute(sql.raw(statement));
      }
      return checkRls(tx);
    });
    expect(found.map((v) => v.message)).toEqual([
      expect.stringMatching(
        /^rls_fixture_child\.\S+ \(member_id\) -> member must be a composite FK/,
      ),
      expect.stringMatching(
        /^rls_fixture_child\.\S+ \(parent_id\) -> rls_fixture_parent must be a composite FK/,
      ),
    ]);
  });
});

describe('tenantTable and tenantPolicy', () => {
  const matter = tenantTable('rls_fixture_matter', { id: id(), title: text('title').notNull() });

  it('adds a NOT NULL workspace_id, an index leading with it, and registers the table', () => {
    const config = getTableConfig(matter);
    const workspace = config.columns.find((c) => c.name === 'workspace_id');
    expect(workspace?.notNull).toBe(true);
    expect(
      config.indexes.map((i) => (i.config.columns[0] as AnyPgColumn | undefined)?.name),
    ).toContain('workspace_id');
    expect(registeredTenantTables()).toContain('rls_fixture_matter');
  });

  it('a table created with its tenantPolicy() in the same migration passes and is isolated', async () => {
    const result = await rolledBack(async (tx) => {
      await tx.execute(sql`create table rls_fixture_matter (
        id uuid primary key default gen_random_uuid(), title text not null, workspace_id uuid not null)`);
      await tx.execute(
        sql`create index rls_fixture_matter_workspace_id_idx on rls_fixture_matter (workspace_id)`,
      );
      for (const statement of tenantPolicy('rls_fixture_matter'))
        await tx.execute(sql.raw(statement));
      const policies = await tx.execute<{ policyname: string; cmd: string }>(sql`
        select policyname::text, cmd::text from pg_policies where tablename = 'rls_fixture_matter'`);
      return { policies, violations: await checkRls(tx) };
    });
    expect(result.policies).toEqual([{ policyname: 'ws_isolation', cmd: 'ALL' }]);
    expect(result.violations).toEqual([]);
  });

  it('the baseline migration contains exactly tenantPolicy() for every baseline tenant table', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(MIGRATION, 'utf8');
    expect(missingTenantPolicies('0006', text, GLOBAL_TABLES)).toEqual([]);
    const normalized = text.replace(/\s+/g, ' ');
    for (const table of BASELINE_TENANT_TABLES) {
      for (const statement of tenantPolicy(table)) expect(normalized).toContain(statement);
    }
  });

  it('flags a later migration that creates a tenant table without its policies', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'causedeck-rls-'));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const create =
      'CREATE TABLE "matter" (\n\t"id" uuid PRIMARY KEY,\n\t"workspace_id" uuid NOT NULL\n);\n';
    writeFileSync(path.join(dir, '0001_old.sql'), create);
    writeFileSync(path.join(dir, '0007_matter.sql'), create);
    writeFileSync(
      path.join(dir, '0008_matter_ok.sql'),
      create.replace('"matter"', '"matter_ok"') +
        tenantPolicy('matter_ok')
          .map((s) => `${s};--> statement-breakpoint\n`)
          .join(''),
    );
    expect(checkMigrationPolicies(dir).map((i) => `${i.file}:${i.table}`)).toEqual([
      '0007_matter.sql:matter',
    ]);
  });
});

describe('db:check-rls CLI', () => {
  const run = (...args: string[]) =>
    runCli('pnpm', ['exec', 'tsx', 'scripts/check-rls.ts', ...args], PACKAGE_DIR);

  it('passes the migrated database and fails on a fixture table lacking RLS', async () => {
    const db = await createScratchDatabase(testDatabaseUrls(), 'rls_check_cli');
    cleanups.push(db.drop);
    await runMigrations({ url: new Secret(db.owner) });

    const ok = await run('--url', db.owner);
    expect(ok.status, ok.stderr).toBe(0);

    const scratch = createOwnerDb(new Secret(db.owner));
    cleanups.push(() => scratch.$client.end());
    await scratch.execute(
      sql`create table rls_fixture (id uuid primary key, workspace_id uuid not null)`,
    );
    const bad = await run('--url', db.owner);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('[rls-not-forced] rls_fixture');
    expect(bad.stderr).toContain('[missing-ws-isolation] rls_fixture');

    for (const statement of tenantPolicy('rls_fixture')) await scratch.execute(sql.raw(statement));
    const fixed = await run('--url', db.owner);
    expect(fixed.status, fixed.stderr).toBe(0);
    // Three `pnpm exec tsx` spawns plus a migration: 24 s on a free host, over the 60 s default
    // when turbo runs every package's tests at once on the CI runner.
  }, 240_000);
});
