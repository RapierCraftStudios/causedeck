// Schema conventions from spike §4.2, checked over the Drizzle table objects (no database needed):
//   1. `workspace_id` is NOT NULL and leads at least one index.
//   2. No cross-workspace foreign keys: a FK from a tenant table to another tenant table must be
//      composite and pair `workspace_id` with `workspace_id`.
// Tables in GLOBAL_TABLES (not workspace-scoped) are exempt.
import { getTableName, is, SQL } from 'drizzle-orm';
import { getTableConfig, PgTable, type AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * Tables that are not workspace-scoped: the baseline, Better Auth's identity tables, the billing
 * plan catalogue and, later, the court layer. `organization` (the workspace), `member` and `invitation` are tenant roots, not
 * global; RLS for them comes in #19.
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
];

export const WORKSPACE_COLUMN = 'workspace_id';

export interface ConventionViolation {
  table: string;
  rule: 'workspace-not-null' | 'workspace-index' | 'cross-workspace-fk';
  message: string;
}

export interface CheckOptions {
  globalTables?: readonly string[];
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
  { globalTables = GLOBAL_TABLES }: CheckOptions = {},
): ConventionViolation[] {
  const globals = new Set(globalTables);
  const violations: ConventionViolation[] = [];

  for (const table of tables) {
    const config = getTableConfig(table);
    const name = config.name;
    if (!isTenant(table, globals)) continue;

    const workspace = config.columns.find((c) => columnName(c) === WORKSPACE_COLUMN);
    if (workspace && !workspace.notNull) {
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
