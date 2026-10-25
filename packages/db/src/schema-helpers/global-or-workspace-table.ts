// `globalOrWorkspaceTable()` (#344, ADR 0013): declares a global-or-workspace reference table such
// as `forum`. It adds a nullable `workspace_id` (null: system catalogue row; set: a workspace's
// custom row) referencing the workspace, the index leading with it, and registers the table, whose
// migration must run `globalOrWorkspacePolicy(name)` (checked by `db:check-rls`). The table must be
// listed in GLOBAL_OR_WORKSPACE_TABLES. See docs/engineering/tenancy.md.
import type { BuildExtraConfigColumns } from 'drizzle-orm';
import {
  foreignKey,
  pgTable,
  uuid,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';

import { workspaceIndex } from '../columns.ts';
import { registerGlobalOrWorkspaceTable } from '../rls-policies.ts';
import { organization } from '../schema/auth.ts';

function scopeColumn() {
  return uuid('workspace_id');
}

type ScopedColumns<TColumns> = TColumns & { workspaceId: ReturnType<typeof scopeColumn> };

export function globalOrWorkspaceTable<
  TTableName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(
  name: TTableName,
  columns: TColumns,
  extras?: (
    self: BuildExtraConfigColumns<TTableName, ScopedColumns<TColumns>, 'pg'>,
  ) => PgTableExtraConfigValue[],
) {
  registerGlobalOrWorkspaceTable(name);
  const all = { ...columns, workspaceId: scopeColumn() } as ScopedColumns<TColumns>;
  return pgTable(name, all, (t) => [
    workspaceIndex(name, t.workspaceId),
    foreignKey({
      name: `${name}_workspace_id_fk`,
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    ...(extras?.(t) ?? []),
  ]);
}
