// The bootstrap import domain (#57, #548): the plan engine behind the confirm grid. Matched-only
// filtering of list rows, clustering of proceedings into matters, date rules and `buildImportPlan`.
// Not re-exported from the package root.
export {
  buildImportPlan,
  buildPlanFromDrafts,
  istDay,
  type ImportDeps,
  type PlanDraftInput,
} from './bootstrap.ts';
export { clusterProceedings, type ClusterGroup, type ClusterNode } from './cluster.ts';
export { filterMatchedRows, type MatchedRows } from './filter-rows.ts';
export {
  createAdvocateMatcher,
  getAdvocateIdentifiers,
  hasIdentifiers,
  type AdvocateIdentifierInput,
  type AdvocateIdentifiers,
} from './identifiers.ts';
export type {
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
