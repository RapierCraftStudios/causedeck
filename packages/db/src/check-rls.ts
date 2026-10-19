// `db:check-rls` (#19): the database-level twin of the #6 convention checker. It reads the live
// catalog (pg_class, pg_policies, pg_constraint) rather than the Drizzle objects, so hand-written
// SQL cannot slip past it:
//   1. Every `public` table with a `workspace_id` column, outside GLOBAL_TABLES, and every tenant
//      root (`organization`) has ENABLE and FORCE ROW LEVEL SECURITY and a `ws_isolation` policy
//      for ALL commands with both USING and WITH CHECK.
//   2. No foreign key references a tenant table without pairing `workspace_id` on both sides.
//   3. Migrations after the baseline apply `tenantPolicy()` in the migration that creates a tenant
//      table (`checkMigrationPolicies`).
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { sql } from 'drizzle-orm';

import { GLOBAL_TABLES, WORKSPACE_COLUMN } from './conventions.ts';
import {
  missingTenantPolicies,
  RLS_BASELINE_MIGRATION,
  WS_ISOLATION_POLICY,
  type MigrationPolicyIssue,
} from './rls-policies.ts';
import type { Queryable } from './rls.ts';

/** Tables without `workspace_id` that are still tenant-isolated: the workspace itself. */
export const TENANT_ROOT_TABLES: readonly string[] = ['organization'];

export interface RlsViolation {
  table: string;
  rule: 'rls-not-enabled' | 'rls-not-forced' | 'missing-ws-isolation' | 'cross-workspace-fk';
  message: string;
}

export interface CheckRlsOptions {
  globalTables?: readonly string[];
  rootTables?: readonly string[];
}

type TableRow = {
  name: string;
  enabled: boolean;
  forced: boolean;
  has_workspace: boolean;
  isolation: boolean;
};

type ForeignKeyRow = {
  name: string;
  src: string;
  tgt: string;
  cols: string[];
  ref_cols: string[];
};

export async function checkRls(
  db: Queryable,
  { globalTables = GLOBAL_TABLES, rootTables = TENANT_ROOT_TABLES }: CheckRlsOptions = {},
): Promise<RlsViolation[]> {
  const globals = new Set(globalTables);
  const roots = new Set(rootTables);
  const tables = await db.execute<TableRow>(sql`
    select c.relname::text as name,
           c.relrowsecurity as enabled,
           c.relforcerowsecurity as forced,
           exists (select 1 from pg_attribute a
                   where a.attrelid = c.oid and a.attname = ${WORKSPACE_COLUMN}
                     and a.attnum > 0 and not a.attisdropped) as has_workspace,
           exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = c.relname
                     and p.policyname = ${WS_ISOLATION_POLICY} and p.cmd = 'ALL'
                     and p.permissive = 'PERMISSIVE'
                     and p.qual is not null and p.with_check is not null) as isolation
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1`);

  const isTenant = (t: Pick<TableRow, 'name' | 'has_workspace'>) =>
    roots.has(t.name) || (t.has_workspace && !globals.has(t.name));
  const tenants = new Set(tables.filter(isTenant).map((t) => t.name));

  const violations: RlsViolation[] = [];
  for (const t of tables) {
    if (!tenants.has(t.name)) continue;
    if (!t.enabled) {
      violations.push({
        table: t.name,
        rule: 'rls-not-enabled',
        message: `${t.name} needs ALTER TABLE ... ENABLE ROW LEVEL SECURITY (use tenantPolicy()).`,
      });
    }
    if (!t.forced) {
      violations.push({
        table: t.name,
        rule: 'rls-not-forced',
        message: `${t.name} needs ALTER TABLE ... FORCE ROW LEVEL SECURITY (use tenantPolicy()).`,
      });
    }
    if (!t.isolation) {
      violations.push({
        table: t.name,
        rule: 'missing-ws-isolation',
        message: `${t.name} needs a ${WS_ISOLATION_POLICY} policy FOR ALL with USING and WITH CHECK (use tenantPolicy()).`,
      });
    }
  }

  // Tenant tables in the FK sense have a workspace_id (the root is referenced by id, by design).
  const fkTargets = new Set(
    tables.filter((t) => t.has_workspace && !globals.has(t.name)).map((t) => t.name),
  );
  const fks = await db.execute<ForeignKeyRow>(sql`
    select con.conname::text as name, src.relname::text as src, tgt.relname::text as tgt,
           array(select a.attname::text from unnest(con.conkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
                 order by k.ord) as cols,
           array(select a.attname::text from unnest(con.confkey) with ordinality k(attnum, ord)
                 join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum
                 order by k.ord) as ref_cols
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class tgt on tgt.oid = con.confrelid
    join pg_namespace n on n.oid = tgt.relnamespace
    where con.contype = 'f' and n.nspname = 'public'
    order by 2, 1`);
  for (const fk of fks) {
    if (!fkTargets.has(fk.tgt)) continue;
    const pairs = fk.cols.some(
      (col, i) => col === WORKSPACE_COLUMN && fk.ref_cols[i] === WORKSPACE_COLUMN,
    );
    if (fk.cols.length < 2 || !pairs) {
      violations.push({
        table: fk.src,
        rule: 'cross-workspace-fk',
        message: `${fk.src}.${fk.name} (${fk.cols.join(', ')}) -> ${fk.tgt} must be a composite FK that includes ${WORKSPACE_COLUMN} on both sides.`,
      });
    }
  }
  return violations;
}

/**
 * Migrations after the RLS baseline that create a tenant table without its `tenantPolicy()`
 * statements. Earlier migrations created tables whose policies the baseline applies.
 */
export function checkMigrationPolicies(
  folder: string,
  { globalTables = GLOBAL_TABLES }: Pick<CheckRlsOptions, 'globalTables'> = {},
): MigrationPolicyIssue[] {
  return readdirSync(folder)
    .filter((f) => f.endsWith('.sql') && f.replace(/\.sql$/, '') > RLS_BASELINE_MIGRATION)
    .sort()
    .flatMap((f) =>
      missingTenantPolicies(f, readFileSync(path.join(folder, f), 'utf8'), globalTables),
    );
}
