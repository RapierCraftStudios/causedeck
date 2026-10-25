// Court-day services (#493, D-048): live display-board tracking (`pollBoards`, `getLiveHalls`) and the
// call-time estimate (`estimateCallWindow`, `backtestEta`); the flagged bench card (`getBenchCard`, #521).
export * from './board.ts';
export * from './eta.ts';
export * from './bench-card.ts';
// The court day (#58, ADR 0037): the day's listings, clashes, list snapshots and diffs, the manual
// hall marker and the next-date wrappers. `proposeCourtDayNextDate` is named apart from the
// matter-graph `proposeNextDate` (both barrels are re-exported from the package root).
export * from './query.ts';
export { detectClashes, type ClashCandidate } from './clashes.ts';
export {
  diffLists,
  getListDiffs,
  hashRows,
  snapshotList,
  type DiffSide,
  type SnapshotResult,
} from './diff.ts';
export { clearCurrentItem, setCurrentItem, type MarkerRow } from './markers.ts';
export type { CourtDayActor, CourtDayDeps, CourtDayEvent, CourtDayEvents } from './scope.ts';
export { listConflictCards, proposeCourtDayNextDate } from './next-date.ts';
