// `@causedeck/core/lifecycle` (#301, #302, #303): DPDP data lifecycle. Workspace export: the
// exporter registry, requests, download links and the build (#301). Workspace deletion (#302):
// requests with a 14-day cool-off, the tick, the ordered erase, the signed receipt and the invoice
// legal hold. Account deletion and memory erasure (#303). See docs/engineering/data-lifecycle.md.
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
  DELETION_COOLOFF_MS,
  runDeletionTick,
  type DeletionTickDeps,
  type DeletionTickReport,
} from './deletion/cooloff.ts';
export {
  ERASE_STEPS,
  FINALIZE_TABLES,
  PURGE_BATCH,
  PURGE_ORDER,
  purgeCoverage,
  runWorkspaceErase,
  type EraseCtx,
  type EraseDeps,
  type EraseOutcome,
  type EraseStep,
  type PurgeCoverage,
} from './deletion/erase.ts';
export {
  LEGAL_HOLD_RULE,
  LEGAL_HOLD_STATUSES,
  LEGAL_HOLD_YEARS,
  legalHoldRetainUntil,
  retainInvoicesForLegalHold,
} from './deletion/legal-hold.ts';
export {
  buildDeletionReceipt,
  canonicalJson,
  DELETION_RECEIPT_VERSION,
  receiptHash,
  receiptWorkspaceIdHash,
  verifyDeletionReceipt,
  type BuildReceiptInput,
  type DeletionReceipt,
  type DeletionReceiptBody,
  type ReceiptStep,
} from './deletion/receipt.ts';
export {
  ACTIVE_DELETION_STATUSES,
  cancelWorkspaceDeletion,
  DeletionError,
  deletionNoticeCopy,
  getActiveWorkspaceDeletion,
  requestWorkspaceDeletion,
  type DeletionErrorReason,
  type DeletionJob,
  type DeletionNotifyDeps,
  type DeletionRequestCtx,
} from './deletion/request.ts';
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
export {
  CourtDataErasureError,
  eraseCourtDataSubject,
  expireCourtData,
  MASKED_NAME,
  MIN_ERASURE_SUBJECT_LENGTH,
  type CourtDataErasureErrorCode,
  type CourtDataErasureReport,
  type CourtDataErasureRequest,
  type CourtDataExpiryReport,
} from './court-data.ts';
