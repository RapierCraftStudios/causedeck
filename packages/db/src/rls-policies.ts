// Row-level security policy SQL (#19, spike §4.1, docs/engineering/tenancy.md). Every tenant table
// (a `workspace_id` column, not in GLOBAL_TABLES) gets ENABLE + FORCE ROW LEVEL SECURITY and one
// `ws_isolation` policy, in the same migration that creates the table. `tenantTable()` registers
// its table here; `db:check-rls` checks the live database and the migrations against it.
// Global-or-workspace reference tables (#344, `globalOrWorkspaceTable()`) get `tenantPolicy()` plus a
// catalogue read policy and an owner-only catalogue write policy (`globalOrWorkspacePolicy()`).
import { GLOBAL_OR_WORKSPACE_TABLES } from './conventions.ts';

export const WS_ISOLATION_POLICY = 'ws_isolation';

/** The workspace pinned by `withWorkspace` for the current transaction, or null. */
export const CURRENT_WORKSPACE_SQL = "nullif(current_setting('app.workspace_id', true), '')::uuid";

/** The policy predicate: the row belongs to the transaction's workspace. */
export const WS_ISOLATION_PREDICATE = `workspace_id = ${CURRENT_WORKSPACE_SQL}`;

/**
 * Tenant tables that existed before RLS (#15, #151, #177, #200); 0006_rls_baseline applies their
 * policies. Tables created later register through `tenantTable()` and get their policies in the
 * migration that creates them (e.g. the usage tables, #218, in 0010_usage).
 */
export const BASELINE_TENANT_TABLES: readonly string[] = [
  'member',
  'invitation',
  'workspace_settings',
  'workspace_slug_history',
  'job_effect',
  'subscription',
  'entitlement',
  'usage_counter',
  'billing_event',
];

/** Migrations up to and including this one predate the same-migration rule for tenant tables. */
export const RLS_BASELINE_MIGRATION = '0006_rls_baseline';

const registry = new Set<string>(BASELINE_TENANT_TABLES);

export function registerTenantTable(name: string): void {
  registry.add(name);
}

/** Every tenant table known to the code: the baseline plus those built with `tenantTable()`. */
export function registeredTenantTables(): string[] {
  return [...registry].sort();
}

const referenceRegistry = new Set<string>();

export function registerGlobalOrWorkspaceTable(name: string): void {
  referenceRegistry.add(name);
}

/** Every global-or-workspace reference table built with `globalOrWorkspaceTable()`. */
export function registeredGlobalOrWorkspaceTables(): string[] {
  return [...referenceRegistry].sort();
}

/** Lets every workspace read the system catalogue rows (null `workspace_id`). */
export const GLOBAL_READ_POLICY = 'global_read';

/** Lets the owner (migration) role, and only it, write the system catalogue rows. */
export const OWNER_CATALOGUE_POLICY = 'owner_catalogue';

/** The trigger function that checks a single-column FK into a global-or-workspace table. */
export const SCOPE_GUARD_FUNCTION = 'app_reference_scope_guard';

/** `same`: the referenced row has exactly this row's scope; `same_or_global`: or is global. */
export type ScopeGuardMode = 'same' | 'same_or_global';

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** The statements that put a tenant table under row-level security, in migration order. */
export function tenantPolicy(table: string): string[] {
  const t = quoteIdent(table);
  return [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY ${quoteIdent(WS_ISOLATION_POLICY)} ON ${t} AS PERMISSIVE FOR ALL TO PUBLIC USING (${WS_ISOLATION_PREDICATE}) WITH CHECK (${WS_ISOLATION_PREDICATE})`,
  ];
}

/**
 * The statements that put a global-or-workspace reference table under row-level security: the
 * tenant `ws_isolation` policy (app reads and writes inside the current workspace; a null
 * `workspace_id` never passes its WITH CHECK), `global_read` (every workspace reads catalogue rows)
 * and `owner_catalogue` (FORCE RLS binds the owner too; it may write catalogue rows only).
 */
export function globalOrWorkspacePolicy(table: string): string[] {
  const t = quoteIdent(table);
  return [
    ...tenantPolicy(table),
    `CREATE POLICY ${quoteIdent(GLOBAL_READ_POLICY)} ON ${t} AS PERMISSIVE FOR SELECT TO PUBLIC USING (workspace_id IS NULL)`,
    `CREATE POLICY ${quoteIdent(OWNER_CATALOGUE_POLICY)} ON ${t} AS PERMISSIVE FOR ALL TO causedeck_owner USING (workspace_id IS NULL) WITH CHECK (workspace_id IS NULL)`,
  ];
}

/** The trigger name `db:check-rls` expects for a FK column into a global-or-workspace table. */
export function scopeGuardTriggerName(table: string, column: string): string {
  return `${table}_${column}_scope_guard`;
}

/** The trigger that rejects a `column` value pointing at a `refTable` row out of this row's scope. */
export function scopeGuardTrigger(
  table: string,
  column: string,
  refTable: string,
  mode: ScopeGuardMode,
): string {
  return `CREATE TRIGGER ${quoteIdent(scopeGuardTriggerName(table, column))} BEFORE INSERT OR UPDATE OF workspace_id, ${quoteIdent(column)} ON ${quoteIdent(table)} FOR EACH ROW EXECUTE FUNCTION ${SCOPE_GUARD_FUNCTION}('${refTable}', '${column}', '${mode}')`;
}

export interface MigrationPolicyIssue {
  file: string;
  table: string;
  message: string;
}

const CREATE_TABLE =
  /CREATE TABLE (?:IF NOT EXISTS )?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;

/**
 * Tenant tables a migration creates without their RLS statements. A table counts as tenant when its
 * CREATE TABLE body declares `workspace_id` and it is not in `globalTables`; a table in
 * `globalOrWorkspaceTables` needs `globalOrWorkspacePolicy()` instead of `tenantPolicy()`.
 */
export function missingTenantPolicies(
  file: string,
  sqlText: string,
  globalTables: readonly string[],
  globalOrWorkspaceTables: readonly string[] = GLOBAL_OR_WORKSPACE_TABLES,
): MigrationPolicyIssue[] {
  const globals = new Set(globalTables);
  const references = new Set(globalOrWorkspaceTables);
  const normalized = sqlText.replace(/\s+/g, ' ');
  const issues: MigrationPolicyIssue[] = [];
  for (const match of sqlText.matchAll(CREATE_TABLE)) {
    const table = match[1];
    if (table === undefined || globals.has(table)) continue;
    const body = sqlText.slice(match.index + match[0].length).split(/\n\);/)[0] ?? '';
    if (!/"?workspace_id"?\s/.test(body)) continue;
    const expected = references.has(table) ? globalOrWorkspacePolicy(table) : tenantPolicy(table);
    const missing = expected.filter((statement) => !normalized.includes(statement));
    if (missing.length > 0) {
      issues.push({
        file,
        table,
        message: `${table} has workspace_id but the migration lacks: ${missing.join('; ')}`,
      });
    }
  }
  return issues;
}
