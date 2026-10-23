// The bootstrap import domain (#57, #548): the plan engine behind the confirm grid. Matched-only
// filtering of list rows, clustering of proceedings into matters, date rules and `buildImportPlan`.
// Apply and undo (#549) write through matter-graph. Not re-exported from the package root.
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
