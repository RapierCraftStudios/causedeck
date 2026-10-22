// The matter-graph domain (#362, part 1 of #33; spike #1 §5, architecture §2.3): the only writer of
// the graph tables. Services take zod-validated inputs, run in the actor's workspace scope and
// emit `GraphEvent`s through the injected `GraphEvents` port; they never import audit or
// notification code. The canonical next date (#364) changes only through next-date.ts, and the
// proceeding state machine (#363, ADR 0016) is the only writer of `proceeding.state`. The matter
// timeline (#366) reads them all across proceedings; the read models (#386) serve the matters list
// and workspace, and people.ts writes persons and role edges. See docs/engineering/core-domains.md.
export type { GraphActor, MatterGraphDeps } from './context.ts';
export * from './documents.ts';
export {
  expandYear,
  identityKey,
  isSameProceeding,
  normaliseCaseNumber,
  type ProceedingIdentity,
} from './duplicates.ts';
export * from './errors.ts';
export type * from './events.ts';
export * from './matters.ts';
export * from './merge-split.ts';
// Named, not `export *`: next-date.ts also holds the merge's canonical-flag helpers (#365), which
// stay inside the domain.
export {
  chooseNextDateSource,
  confirmNextDate,
  getCanonicalNextDate,
  proposeNextDate,
  type ListingRef,
  type ListingRow,
  type NextDateConflict,
  type NextDateResult,
} from './next-date.ts';
export { setRoleEdge, upsertPerson, type PersonRow, type RoleEdgeRow } from './people.ts';
export {
  createProceeding,
  findDuplicateProceedings,
  linkProceedings,
  normaliseCaseType,
  updateIdentifiers,
  type ProceedingLinkRow,
  type ProceedingRow,
} from './proceedings.ts';
export {
  getMatterOverview,
  listMatterDocuments,
  listMatterPeople,
  listMatterProceedingsTree,
  searchMatters,
  type DocumentSource,
  type ForumSummary,
  type ListingDetail,
  type ListingProvenance,
  type MatterDocumentPage,
  type MatterDocumentRow,
  type MatterListPage,
  type MatterListRow,
  type MatterOverview,
  type MatterPeopleGroup,
  type NextDateConflictView,
  type NextDateSummary,
  type OwnerSummary,
  type PersonView,
  type ProceedingLinkView,
  type ProceedingNode,
  type RoleEdgeView,
} from './read-models.ts';
export {
  assertTransition,
  PROCEEDING_TRANSITIONS,
  transitionProceeding,
  type ProceedingStateChangeRow,
  type ProceedingTransition,
} from './state-machine.ts';
export {
  getMatterTimeline,
  type TimelineEvent,
  type TimelineEventKind,
  type TimelineProvenance,
} from './timeline.ts';
