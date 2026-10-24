// The case-status watch domain (#591, part 3 of #483, D-048): an advocate's own watches on their
// proceedings, delegated lookups through the governed fetch layer, snapshots with provenance (tier
// used, cost, device or server) and the next-date proposals a status change stages.
export {
  addCaseWatch,
  listCaseWatches,
  removeCaseWatch,
  type AddCaseWatchInput,
  type CaseWatchRow,
} from './watch.ts';
export {
  hashStatusFields,
  recordDeviceSnapshot,
  runCaseStatusLookup,
  STATUS_SOURCES,
  touchWatchPolled,
  type CaseStatusLookupDeps,
  type CaseStatusLookupOutcome,
  type CaseStatusLookupReport,
  type StatusFetcher,
  type StatusSource,
} from './lookup.ts';
export {
  diffStatus,
  hasChanges,
  statusChangeDraft,
  type StatusChanges,
  type StatusDraftInput,
} from './diff.ts';
export {
  MAX_PER_ADVOCATE_PER_RUN,
  MAX_PER_SOURCE_PER_RUN,
  MAX_WATCHES_PER_RUN,
  pollCaseWatches,
  type DueWatch,
  type PollCaseWatchesDeps,
  type PollCaseWatchesReport,
} from './poll.ts';
export { notifyStatusChanges, type StatusAlertDeps, type StatusAlertInput } from './alerts.ts';
export {
  MAX_ORDERS_PER_WATCH_PER_RUN,
  pollOrders,
  type PollOrdersDeps,
  type PollOrdersReport,
} from './orders.ts';
