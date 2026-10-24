// The migration concierge (#685, part of #508): bulk matter import for onboarding a firm. A CSV
// portfolio file is mapped to columns (`parseMigrationCsv`), dry-run to report mapping issues
// without writing, then imported in chunks that resume and roll back (through the import domain's
// `applyImportPlan` and `undoImportBatch`). Reached as `@causedeck/core/migration`; not
// re-exported from the package root.
export {
  BLOCKING_ISSUES,
  MAX_MIGRATION_ROWS,
  MIGRATION_FIELDS,
  MIGRATION_ISSUE_CODES,
  parseMigrationCsv,
  readCsvRecords,
  type ColumnMapping,
  type MigrationField,
  type MigrationIssueCode,
  type MigrationRow,
  type ParsedMigrationFile,
} from './csv.ts';
export {
  findMigrationOwner,
  getMigrationProgress,
  getMigrationReport,
  listMigrationRuns,
  MIGRATION_CHUNK_SIZE,
  resumeMigrationRun,
  rollbackMigrationRun,
  runMigrationChunk,
  startMigrationRun,
  type MigrationActor,
  type MigrationDeps,
  type MigrationProgress,
  type MigrationReport,
  type MigrationReportEntry,
  type StartMigrationInput,
} from './run.ts';
