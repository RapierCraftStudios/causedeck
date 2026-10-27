// The drafting domain's public surface (#768). Other domains import this file only.
export {
  applyFix,
  getConsistencyReport,
  listFindings,
  loadConsistencyFacts,
  runConsistencyCheck,
  type StoredReport,
} from './consistency-service.ts';
export {
  createDraft,
  exportDraft,
  listVersions,
  renderDraft,
  restoreVersion,
  saveVersion,
  type CreateDraftInput,
  type DraftExportRow,
  type DraftingDeps,
  type DraftSummary,
  type DraftVersionSummary,
  type ExportDraftDeps,
  type ExportDraftResult,
  type RenderedDraft,
} from './service.ts';
export {
  createDraftExportDownload,
  runDraftingExport,
  type DraftExportDownloadCtx,
  type DraftingExportCtx,
  type DraftingExportPayload,
  type DraftingExportResult,
} from './export.ts';
export type { DraftActor } from './policy.ts';
export {
  checkDraft,
  getCitationReport,
  reportFromRows,
  type CheckDraftDeps,
  type CitationActor,
} from './citations.ts';
export {
  acknowledgeFactCheck,
  acknowledgeUnverified,
  assertCitationsClear,
  assertFactCheckClear,
  exportBlockedByCitations,
  exportBlockedByFactCheck,
  type AcknowledgeFactCheckResult,
  type AcknowledgeResult,
  type CitationExportGate,
  type FactCheckExportGate,
} from './citation-ack.ts';
export {
  ignoreForMatter,
  loadFactCheckFacts,
  markAsAssertion,
  recordFactFix,
  runFactCheck,
  type FactCheckResult,
  type FactFixResult,
  type FactResolution,
  type FactVerdictView,
} from './factcheck-service.ts';
export {
  getDraft,
  listDrafts,
  listTemplates,
  type DraftDetail,
  type DraftListItem,
  type DraftReadDeps,
  type TemplateSuggestion,
} from './read.ts';
