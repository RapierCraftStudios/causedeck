// `@causedeck/core/lifecycle` (#301): DPDP data lifecycle. Workspace export: the exporter
// registry, requests, download links and the build (#301). Account deletion and memory erasure
// (#303). Workspace deletion lands with #302. See docs/engineering/data-lifecycle.md.
import './export/exporters.ts';

export {
  CSV_TABLES,
  EXPORT_EXCLUSIONS,
  exportCoverage,
  exporterFor,
  registeredExporters,
  registerExporter,
  type ExportCoverage,
  type ExportCtx,
  type Exporter,
} from './export/registry.ts';
export {
  MANIFEST_PATH,
  MANIFEST_VERSION,
  README_PATH,
  verifyManifest,
  type ExportManifest,
  type ManifestFile,
  type ManifestMismatch,
} from './export/manifest.ts';
export { planExport, type ExportPlan, type PlannedTable } from './export/plan.ts';
export {
  EXPORT_TTL_MS,
  exportFilename,
  runExportBuild,
  type ExportBuildCtx,
  type ExportBuildDeps,
  type ExportBuildOutcome,
} from './export/run.ts';
export {
  EXPORT_HISTORY_LIMIT,
  EXPORT_TOKEN_NONCE_BYTES,
  getExportJob,
  issueExportDownload,
  listExportJobs,
  openExportDownload,
  readExportToken,
  requestExport,
  type ExportDownload,
  type ExportDownloadDeps,
  type ExportDownloadLink,
  type ExportJob,
  type ExportRequestCtx,
  type ExportTokenPayload,
  type RequestExportDeps,
} from './export/request.ts';
export {
  ACCOUNT_DELETION_ERRORS,
  ACCOUNT_DELETION_SOLE_OWNER_MESSAGE,
  ACCOUNT_DELETION_STAFF_MESSAGE,
  requestAccountDeletion,
  runAccountDeletion,
  soleOwnedWorkspaces,
  type AccountDeletionCtx,
  type AccountDeletionError,
  type AccountDeletionJob,
  type AccountDeletionOutcome,
  type AccountDeletionRunCtx,
  type RequestAccountDeletionDeps,
  type SoleOwnedWorkspace,
} from './deletion/account.ts';
export {
  eraseMemory,
  MEMORY_ERASE_BATCH,
  MEMORY_ERASE_PRIORITY,
  MEMORY_ERASURE_SLA_MS,
  MEMORY_TABLES,
  requestMemoryErasure,
  runMemoryErasure,
  type MemoryErasureCtx,
  type MemoryErasureJob,
  type MemoryErasureOutcome,
  type MemoryErasureRunCtx,
  type RequestMemoryErasureDeps,
} from './deletion/memory.ts';
