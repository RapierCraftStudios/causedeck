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
import { GLOBAL_OR_WORKSPACE_TABLES, GLOBAL_TABLES } from '../../conventions.ts';
import { runMigrations } from '../../migrate.ts';
import { createOwnerDb } from '../../owner.ts';
import {
  BASELINE_TENANT_TABLES,
  globalOrWorkspacePolicy,
  missingTenantPolicies,
  registeredTenantTables,
  scopeGuardTrigger,
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
    // Baseline tables plus the tenant tables created after 0006 (#226, #194, #218, #22, #216, #252, #233, #217, #301, #308).
    expect(rows.map((r) => r.name)).toEqual(
      [
        ...BASELINE_TENANT_TABLES,
        'audit_event',
        'authority',
        'ai_call',
        'ai_call_result',
        'news_pref',
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
        'support_session',
        'workspace_integration',
        'intake_address',
        'intake_allowlist',
        'intake_message',
        // Global-or-workspace reference tables (#344): ws_isolation plus catalogue policies.
        'forum',
        'court_hall',
        'bench',
        'template',
        // Matter and documents (#345).
        'matter',
        'document',
        'document_page',
        // Drafting (#766).
        'draft',
        'draft_consistency_report',
        'draft_export',
        'draft_fact_ack',
        'draft_version',
        'anchor',
        // Proceedings (#346).
        'proceeding',
        'proceeding_link',
        // Proceeding state history (#363).
        'proceeding_state_change',
        // Docket (#347).
        'listing',
        'hearing',
        'appearance',
        'order',
        'obligation',
        'obligation_event',
        'defect',
        'certified_copy',
        // Outward update drafts (#735).
        'outward_draft',
        'correction',
        // Stale-matter attention (#70).
        'attention_snooze',
        'outward_draft_version',
        'outward_share_log',
        'task',
        // People (#348).
        'person',
        'organisation',
        'role_edge',
        // Adapter parse health (#372).
        'adapter_parse_run',
        // Bench rosters (#384).
        'bench_roster',
        'bench_roster_entry',
        'bench_change_alert',
        // Automation engine (#47).
        'proposal',
        'activity',
        'automation_preference',
        'automation_threshold',

        // Capture inbox (#43).
        'capture',
        'workspace_capture_channel',

        // Calendar interop (#53).
        'ics_feed',
        'ics_feed_event',
        'ics_import_event',

        // Public API keys (#624).
        'api_key',

        // Change webhooks (#626).
        'webhook_endpoint',
        'webhook_delivery',

        // Institution portfolios (#661).
        'portfolio',
        'portfolio_case',
        'portfolio_panel_advocate',

        // WhatsApp number link and OTP challenge (#678); inbound dedupe ledger (#680).
        'whatsapp_link',
        'whatsapp_otp_challenge',
        'whatsapp_inbound_message',
        // Lawyer memory (#72).
        'memory_item',
        'memory_proposal',
        'memory_embedding',
        'memory_usage',
        'memory_pause',
        // M5 precedent bank (#901).
        'precedent_passage',

        // Enterprise onboarding (#682).
        'sso_provider',
        'scim_token',
        'provisioning_run',
        'migration_run',
        'migration_run_row',

        // Case-status watch (#589).
        'case_watch',
        'case_status_snapshot',

        // Court-day marker and list snapshots (#58).
        'court_day_marker',
        'list_snapshot',

        // Brief state (#60).
        'brief_state',

        // Continuity (#71).
        'matter_view',
        'handover_note',

        // Brief sharing (#507).
        'brief_share',
        // Court-day reminders (#64).
        'reminder_dispatch',

        // Review and correction queue (#518).
        'review_correction',

        // Anchored order extraction (#46).
        'extraction',

        // Bootstrap import (#57, #546).
        'import_batch',
        'import_batch_file',
        'import_plan',

        // Advocate identifiers for the bootstrap import (#57, #550).
        'advocate_profile',

        // Karnataka HC cause-list watches (#482).
        'cause_list_watch',
        // Judgment alerts (#497).
        'matter_issue_tag',
        'judgment_alert',
        // Research notes and providers (#80).
        'research_note',
        'research_provider',
        // Court document network (#485).
        'contribution_ledger',

        // Official notices feed (#584).
        'notice_match',

        // Client contacts (#82).
        'client_contact',

        // Inbound enquiry log (#87).
        'enquiry',
        'enquiry_party',
        'conflict_check_result',
        // Fees (#83).
        'fee_agreement',
        'fee_invoice',
        'fee_invoice_line',
        'payment',
        'client_ledger_entry',
      ].sort(),
    );
    for (const row of rows)
      expect(row, row.name).toMatchObject({ enabled: true, forced: true, policy: true });
    expect(await checkRls(owner)).toEqual([]);
  });

  it('keeps audit_actor_salt global and out of reach of the app and clerk roles (#303)', async () => {
    const [row] = await owner.execute<{ enabled: boolean; app: boolean; clerk: boolean }>(sql`
      select c.relrowsecurity as enabled,
             has_table_privilege('causedeck_app', c.oid, 'select, insert, update, delete') as app,
             has_table_privilege('causedeck_clerk', c.oid, 'select, insert, update, delete') as clerk
      from pg_class c where c.relname = 'audit_actor_salt'`);
    expect(row).toEqual({ enabled: false, app: false, clerk: false });
    expect(GLOBAL_TABLES).toContain('audit_actor_salt');
  });

  it('lets account deletion jobs (no workspace) through account_self only (#303)', async () => {
    const policies = await owner.execute<{ policyname: string; cmd: string }>(sql`
      select policyname::text, cmd::text from pg_policies
      where tablename = 'deletion_job' order by policyname`);
    expect(policies).toEqual([
      { policyname: 'account_self', cmd: 'ALL' },
      // Owner role only: backs app_deletion_due_jobs (#302, 0032).
      { policyname: 'owner_definer_read', cmd: 'SELECT' },
      { policyname: 'ws_isolation', cmd: 'ALL' },
    ]);
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

describe('global-or-workspace reference tables (#344)', () => {
  it('forum, court_hall, bench and template have exactly ws_isolation, global_read and owner_catalogue', async () => {
    const rows = await owner.execute<{ tablename: string; policyname: string; cmd: string }>(sql`
      select tablename::text, policyname::text, cmd::text from pg_policies
      where tablename in ('forum', 'court_hall', 'bench', 'template') order by 1, 2`);
    expect(rows).toEqual(
      ['bench', 'court_hall', 'forum', 'template'].flatMap((t) => [
        { tablename: t, policyname: 'global_read', cmd: 'SELECT' },
        { tablename: t, policyname: 'owner_catalogue', cmd: 'ALL' },
        { tablename: t, policyname: 'ws_isolation', cmd: 'ALL' },
      ]),
    );
  });

  it('flags missing catalogue policies and a FK into the table without a scope guard', async () => {
    const options = {
      globalOrWorkspaceTables: [...GLOBAL_OR_WORKSPACE_TABLES, 'gw_fixture_ref', 'gw_fixture_bare'],
    };
    const found = await rolledBack(async (tx) => {
      for (const t of ['gw_fixture_ref', 'gw_fixture_bare']) {
        await tx.execute(sql.raw(`create table ${t} (id uuid primary key, workspace_id uuid)`));
      }
      await tx.execute(sql`create table gw_fixture_child (
        id uuid primary key, workspace_id uuid not null,
        ref_id uuid references gw_fixture_ref (id),
        guarded_id uuid references gw_fixture_ref (id))`);
      for (const statement of [
        ...globalOrWorkspacePolicy('gw_fixture_ref'),
        ...tenantPolicy('gw_fixture_bare'),
        ...tenantPolicy('gw_fixture_child'),
        scopeGuardTrigger('gw_fixture_child', 'guarded_id', 'gw_fixture_ref', 'same_or_global'),
      ])
        await tx.execute(sql.raw(statement));
      return checkRls(tx, options);
    });
    expect(rules(found)).toEqual([
      'gw_fixture_bare:missing-global-or-workspace-policy',
      'gw_fixture_child:missing-scope-guard',
    ]);
    expect(found.find((v) => v.rule === 'missing-scope-guard')?.message).toContain(
      'gw_fixture_child_ref_id_scope_guard',
    );
  });

  it('requires globalOrWorkspacePolicy() in the migration that creates a listed table', () => {
    const create = 'CREATE TABLE "gw_ref" (\n\t"id" uuid PRIMARY KEY,\n\t"workspace_id" uuid\n);\n';
    const tenantOnly =
      create +
      tenantPolicy('gw_ref')
        .map((s) => `${s};\n`)
        .join('');
    const full =
      create +
      globalOrWorkspacePolicy('gw_ref')
        .map((s) => `${s};\n`)
        .join('');
    expect(missingTenantPolicies('x.sql', tenantOnly, GLOBAL_TABLES, ['gw_ref'])).toHaveLength(1);
    expect(missingTenantPolicies('x.sql', full, GLOBAL_TABLES, ['gw_ref'])).toEqual([]);
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
