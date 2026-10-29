// The bootstrap import domain (#57, #548): the plan engine behind the confirm grid. Matched-only
// filtering of list rows, clustering of proceedings into matters, date rules and `buildImportPlan`.
// Apply and undo (#549) write through matter-graph. The batch (#550) takes uploaded captures through
// the capture pipeline and the court adapters to a plan; the advocate's identifiers live in
// `profile`. Reached as `@causedeck/core/import`; not re-exported from the package root.
export {
  addImportFiles,
  createImportBatch,
  createListParser,
  finishImportBatch,
  getImportProgress,
  listRowPayloads,
  markImportFileFailed,
  markImportFilesOverCap,
  NEEDS_ADAPTER_NOTE,
  NEEDS_DEDICATED_ADAPTER,
  OVER_OCR_CAP,
  processImportFile,
  startImportProcessing,
  type FinishImportOutcome,
  type ImportBatchDeps,
  type ImportFileOutcome,
  type ImportProgress,
  type ListParseInput,
  type ListParseResult,
  type ListParser,
  type PendingImportFile,
} from './batch.ts';
export { getChamberMapping, saveChamberMapping } from './column-mapping.ts';
export {
  getAdvocateProfile,
  saveAdvocateProfile,
  type ProfileScope,
  type SaveProfileResult,
} from './profile.ts';
export {
  buildImportPlan,
  buildPlanFromDrafts,
  istDay,
  type ImportDeps,
  type PlanDraftInput,
} from './bootstrap.ts';
export {
  applyImportPlan,
  hashPlan,
  importGroupId,
  IMPORT_UNDO_WINDOW_MS,
  type ApplyDeps,
  type MatterUndoPayload,
} from './apply.ts';
export {
  getImportPlan,
  regroupPlan,
  saveEditedImportPlan,
  type PlanEditDeps,
  type PlanGroupEdit,
} from './plan-edit.ts';
export { clusterProceedings, type ClusterGroup, type ClusterNode } from './cluster.ts';
export {
  batchCostPaise,
  documentPageCounts,
  recordBatchUsage,
  splitByOcrAllowance,
  type FileAllowance,
  type ImportFile,
} from './entitlements.ts';
export { filterMatchedRows, type MatchedRows } from './filter-rows.ts';
export {
  createAdvocateMatcher,
  getAdvocateIdentifiers,
  hasIdentifiers,
  type AdvocateIdentifierInput,
  type AdvocateIdentifiers,
} from './identifiers.ts';
export { undoImportBatch, type UndoImportResult } from './undo.ts';
export type {
  ApplyDecisions,
  ApplyDuplicate,
  ApplyResult,
  ImportPlan,
  PlanDate,
  PlanHistoryEntry,
  PlanIssue,
  PlanIssueCode,
  PlanMatter,
  PlanObligation,
  PlanProceeding,
  PlanSource,
} from './plan-types.ts';
