// `@causedeck/db`: Drizzle schema, column conventions and the app-role client. The owner-role
// client and the migrator are intentionally not exported; see docs/engineering/database.md.
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
export * as schema from './schema/index.ts';
export { EMBEDDING_DIMENSIONS, embedding } from './vector.ts';
