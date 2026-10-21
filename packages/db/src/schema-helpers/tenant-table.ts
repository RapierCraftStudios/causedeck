// `tenantTable()` (#19): the one way to declare a new workspace-scoped table. It adds the NOT NULL
// `workspace_id` column and the index leading with it (spike §4.2), and registers the table for
// row-level security, so `db:check-rls` fails until the migration that creates the table also runs
// `tenantPolicy(name)` (ENABLE + FORCE RLS and `ws_isolation`). See docs/engineering/tenancy.md.
import type { BuildExtraConfigColumns } from 'drizzle-orm';
import {
  pgTable,
  type PgColumnBuilderBase,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';

import { workspaceId, workspaceIndex } from '../columns.ts';
import { registerTenantTable } from '../rls-policies.ts';

type TenantColumns<TColumns> = TColumns & { workspaceId: ReturnType<typeof workspaceId> };

export function tenantTable<
  TTableName extends string,
  TColumns extends Record<string, PgColumnBuilderBase>,
>(
  name: TTableName,
  columns: TColumns,
  extras?: (
    self: BuildExtraConfigColumns<TTableName, TenantColumns<TColumns>, 'pg'>,
  ) => PgTableExtraConfigValue[],
) {
  registerTenantTable(name);
  const all = { ...columns, workspaceId: workspaceId() } as TenantColumns<TColumns>;
  return pgTable(name, all, (t) => [workspaceIndex(name, t.workspaceId), ...(extras?.(t) ?? [])]);
}
