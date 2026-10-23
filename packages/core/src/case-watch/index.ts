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
