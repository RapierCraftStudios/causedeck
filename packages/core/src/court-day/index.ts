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
// Court-day reminders (#64, ADR 0039): pure builders for the evening brief, the morning diff and the missing outcomes.
export {
  addDays,
  buildEveningBrief,
  buildMorningDiff,
  eveningPushPayload,
  findMissingOutcomes,
  LOW_READINESS_BELOW,
  OUTCOME_FALLBACK_TIME,
  type EveningBrief,
  type EveningBriefInput,
  type EveningPushPayload,
  type HearingForOutcome,
  type MissingOutcome,
  type MissingOutcomeInput,
  type MorningDiff,
} from './reminders.ts';
