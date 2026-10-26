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
  acknowledgeUnverified,
  assertCitationsClear,
  exportBlockedByCitations,
  type AcknowledgeResult,
  type CitationExportGate,
} from './citation-ack.ts';
export {
  getDraft,
  listDrafts,
  listTemplates,
  type DraftDetail,
  type DraftListItem,
  type DraftReadDeps,
  type TemplateSuggestion,
} from './read.ts';
