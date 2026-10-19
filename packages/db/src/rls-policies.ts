// Row-level security policy SQL (#19, spike §4.1, docs/engineering/tenancy.md). Every tenant table
// (a `workspace_id` column, not in GLOBAL_TABLES) gets ENABLE + FORCE ROW LEVEL SECURITY and one
// `ws_isolation` policy, in the same migration that creates the table. `tenantTable()` registers
// its table here; `db:check-rls` checks the live database and the migrations against it.

export const WS_ISOLATION_POLICY = 'ws_isolation';

/** The workspace pinned by `withWorkspace` for the current transaction, or null. */
export const CURRENT_WORKSPACE_SQL = "nullif(current_setting('app.workspace_id', true), '')::uuid";

/** The policy predicate: the row belongs to the transaction's workspace. */
export const WS_ISOLATION_PREDICATE = `workspace_id = ${CURRENT_WORKSPACE_SQL}`;

/**
 * Tenant tables that existed before RLS (#15, #151, #177, #200); 0006_rls_baseline applies their
 * policies. Tables created later register through `tenantTable()` and get their policies in the
 * migration that creates them (e.g. the usage tables, #218, in 0007_usage).
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

export interface MigrationPolicyIssue {
  file: string;
  table: string;
  message: string;
}

const CREATE_TABLE =
  /CREATE TABLE (?:IF NOT EXISTS )?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;

/**
 * Tenant tables a migration creates without their RLS statements. A table counts as tenant when its
 * CREATE TABLE body declares `workspace_id` and it is not in `globalTables`.
 */
export function missingTenantPolicies(
  file: string,
  sqlText: string,
  globalTables: readonly string[],
): MigrationPolicyIssue[] {
  const globals = new Set(globalTables);
  const normalized = sqlText.replace(/\s+/g, ' ');
  const issues: MigrationPolicyIssue[] = [];
  for (const match of sqlText.matchAll(CREATE_TABLE)) {
    const table = match[1];
    if (table === undefined || globals.has(table)) continue;
    const body = sqlText.slice(match.index + match[0].length).split(/\n\);/)[0] ?? '';
    if (!/"?workspace_id"?\s/.test(body)) continue;
    const missing = tenantPolicy(table).filter((statement) => !normalized.includes(statement));
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
