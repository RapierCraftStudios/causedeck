// Schema conventions from spike §4.2, checked over the Drizzle table objects (no database needed):
//   1. `workspace_id` is NOT NULL (outside NULLABLE_WORKSPACE_TABLES) and leads at least one index.
//   2. No cross-workspace foreign keys: a FK from a tenant table to another tenant table must be
//      composite and pair `workspace_id` with `workspace_id`.
// Tables in GLOBAL_TABLES (not workspace-scoped) are exempt.
import { getTableName, is, SQL } from 'drizzle-orm';
import { getTableConfig, PgTable, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Tables that are not workspace-scoped: the baseline, Better Auth's identity tables, the billing
 * plan catalogue and, later, the court layer. They carry no row-level security; everything else with
 * a `workspace_id` column is a tenant table under FORCE RLS (`db:check-rls`,
 * docs/engineering/tenancy.md). `organization` (the workspace) is the tenant root with its own
 * policies; `member` and `invitation` are tenant tables. `api_idempotency_key` has a nullable
 * `workspace_id` but is keyed by user, so it stays global. `push_subscription` (per user) and
 * `email_suppression` (per address) have no workspace (#194). `feature_flag` (staff-managed global
 * flag rows) and `access_mode_registry` (court-adapter access modes) are global by design (#22); the
 * per-workspace overrides are the tenant table `workspace_feature_flag`.
 */
export const GLOBAL_TABLES: readonly string[] = [
  'schema_info',
  'user',
  'session',
  'account',
  'verification',
  'passkey',
  'two_factor',
  'rate_limit',
  'api_idempotency_key',
  'plan',
  'push_subscription',
  'email_suppression',
  'feature_flag',
  'access_mode_registry',
];

/**
 * Tenant tables whose `workspace_id` may be null. `audit_event` holds account-level events (sign-in,
 * passkey, 2FA) that belong to no workspace; they are written only through `app_audit_append()` and
 * read through the `account_self` policy. The table is still under FORCE RLS with `ws_isolation`, and
 * still needs an index led by `workspace_id`. Adding a table here is a security decision.
 */
export const NULLABLE_WORKSPACE_TABLES: readonly string[] = ['audit_event'];

export const WORKSPACE_COLUMN = 'workspace_id';

export interface ConventionViolation {
  table: string;
  rule: 'workspace-not-null' | 'workspace-index' | 'cross-workspace-fk';
  message: string;
}

export interface CheckOptions {
  globalTables?: readonly string[];
  nullableWorkspaceTables?: readonly string[];
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** The database name of a column (helpers use explicit names; bare keys go through `casing`). */
function columnName(column: AnyPgColumn): string {
  return column.keyAsName ? toSnakeCase(column.name) : column.name;
}

function isTenant(table: PgTable, globals: ReadonlySet<string>): boolean {
  const config = getTableConfig(table);
  return (
    !globals.has(config.name) && config.columns.some((c) => columnName(c) === WORKSPACE_COLUMN)
  );
}

/** Every `PgTable` among a module's exports (enums and other values are skipped). */
export function tablesOf(exports: Record<string, unknown>): PgTable[] {
  return Object.values(exports).filter((value): value is PgTable => is(value, PgTable));
}

export function checkSchemaConventions(
  tables: readonly PgTable[],
  {
    globalTables = GLOBAL_TABLES,
    nullableWorkspaceTables = NULLABLE_WORKSPACE_TABLES,
  }: CheckOptions = {},
): ConventionViolation[] {
  const globals = new Set(globalTables);
  const nullable = new Set(nullableWorkspaceTables);
  const violations: ConventionViolation[] = [];

  for (const table of tables) {
    const config = getTableConfig(table);
    const name = config.name;
    if (!isTenant(table, globals)) continue;

    const workspace = config.columns.find((c) => columnName(c) === WORKSPACE_COLUMN);
    if (workspace && !workspace.notNull && !nullable.has(name)) {
      violations.push({
        table: name,
        rule: 'workspace-not-null',
        message: `${name}.${WORKSPACE_COLUMN} must be NOT NULL (use workspaceId()).`,
      });
    }

    const leadsAnIndex = config.indexes.some((idx) => {
      const first = idx.config.columns[0];
      return (
        first !== undefined &&
        !is(first, SQL) &&
        columnName(first as AnyPgColumn) === WORKSPACE_COLUMN
      );
    });
    const leadsPrimaryKey = config.primaryKeys.some(
      (pk) => pk.columns[0] !== undefined && columnName(pk.columns[0]) === WORKSPACE_COLUMN,
    );
    if (!leadsAnIndex && !leadsPrimaryKey) {
      violations.push({
        table: name,
        rule: 'workspace-index',
        message: `${name} needs an index whose first column is ${WORKSPACE_COLUMN} (use workspaceIndex()).`,
      });
    }

    for (const fk of config.foreignKeys) {
      const ref = fk.reference();
      if (!isTenant(ref.foreignTable, globals)) continue;
      const target = getTableName(ref.foreignTable);
      const pairsWorkspace = ref.columns.some(
        (col, i) =>
          columnName(col) === WORKSPACE_COLUMN &&
          ref.foreignColumns[i] !== undefined &&
          columnName(ref.foreignColumns[i]) === WORKSPACE_COLUMN,
      );
      if (ref.columns.length < 2 || !pairsWorkspace) {
        const cols = ref.columns.map(columnName).join(', ');
        violations.push({
          table: name,
          rule: 'cross-workspace-fk',
          message: `${name}(${cols}) -> ${target} must be a composite FK that includes ${WORKSPACE_COLUMN} on both sides.`,
        });
      }
    }
  }
  return violations;
}
