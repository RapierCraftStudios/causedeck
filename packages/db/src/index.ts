// `@causedeck/db`: Drizzle schema, column conventions and the app-role client. The owner-role
// client and the migrator are intentionally not exported; see docs/engineering/database.md.
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import { organization } from './schema/auth.ts';

export {
  closeDb,
  createDb,
  db,
  type CreateDbOptions,
  type Database,
  type DbRole,
  type Schema,
  type Transaction,
} from './client.ts';
export * from './columns.ts';
export {
  checkSchemaConventions,
  GLOBAL_TABLES,
  tablesOf,
  type ConventionViolation,
} from './conventions.ts';
export { DatabaseConnectionError } from './redact.ts';
export {
  currentScope,
  isUuid,
  TENANCY_VIOLATION,
  TenancyError,
  withoutWorkspace,
  withUser,
  withWorkspace,
  type GlobalScope,
  type Queryable,
  type TenancyScope,
  type UserScope,
  type WorkspaceScope,
} from './rls.ts';
export { registeredTenantTables, tenantPolicy, WS_ISOLATION_POLICY } from './rls-policies.ts';
export { tenantTable } from './schema-helpers/tenant-table.ts';
export * as schema from './schema/index.ts';

/** Better Auth's organization is the workspace (ADR 0004); domain code uses this name. */
export const workspace: typeof organization = organization;
export type Workspace = InferSelectModel<typeof organization>;
export type NewWorkspace = InferInsertModel<typeof organization>;
export { EMBEDDING_DIMENSIONS, embedding } from './vector.ts';
