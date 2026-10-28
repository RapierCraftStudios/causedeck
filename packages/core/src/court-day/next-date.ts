// The court day's view of the canonical next date (#58, ADR 0037). Each proceeding keeps exactly one
// canonical next date; this module wraps the matter-graph services (through its index only) and
// adds nothing of its own: a proposal is stored as a non-canonical `proposed` listing (L2), one that
// disagrees with the confirmed date comes back as a conflict card holding both sides, and a
// confirmed date is never overwritten here (only `confirmNextDate` and `chooseNextDateSource` do,
// through a person). The wrapper is named apart from the matter-graph `proposeNextDate` because
// both barrels are re-exported from `@causedeck/core`.
import {
  getMatterOverview,
  proposeNextDate,
  type GraphActor,
  type MatterGraphDeps,
  type NextDateConflictView,
  type NextDateResult,
} from '../matter-graph/index.ts';

type ProposeInput = Parameters<typeof proposeNextDate>[2];

/** Propose a next date for a proceeding. Needs `matter.write`; never changes the canonical date. */
export function proposeCourtDayNextDate(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: ProposeInput,
): Promise<NextDateResult> {
  return proposeNextDate(deps, actor, input);
}

/** The matter's unresolved next-date conflict cards: the confirmed date beside each proposal. */
export async function listConflictCards(
  deps: MatterGraphDeps,
  actor: GraphActor,
  input: { matterId: string },
): Promise<NextDateConflictView[]> {
  const overview = await getMatterOverview(deps, actor, input);
  return overview.conflicts;
}
