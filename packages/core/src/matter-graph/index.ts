// The matter-graph domain (#362, part 1 of #33; spike #1 §5, architecture §2.3): the only writer of
// the graph tables. Services take zod-validated inputs, run in the actor's workspace scope and
// emit `GraphEvent`s through the injected `GraphEvents` port; they never import audit or
// notification code. The proceeding state machine (#363, ADR 0014) is the only writer of
// `proceeding.state`. See docs/engineering/core-domains.md.
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
  assertTransition,
  PROCEEDING_TRANSITIONS,
  transitionProceeding,
  type ProceedingStateChangeRow,
  type ProceedingTransition,
} from './state-machine.ts';
