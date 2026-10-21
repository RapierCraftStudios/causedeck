// The matter-graph domain (#362, part 1 of #33; spike #1 §5, architecture §2.3): the only writer of
// the graph tables. Services take zod-validated inputs, run in the actor's workspace scope and
// emit `GraphEvent`s through the injected `GraphEvents` port; they never import audit or
// notification code. The canonical next date (#364) changes only through next-date.ts. See
// docs/engineering/core-domains.md.
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
  confirmNextDate,
  getCanonicalNextDate,
  proposeNextDate,
  type ListingRef,
  type ListingRow,
  type NextDateConflict,
  type NextDateResult,
} from './next-date.ts';
export * from './proceedings.ts';
