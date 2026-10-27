// Briefs (#60, ADR 0038): the derived per-listing preparation brief, its readiness score, the
// lawyer-authored `brief_state` and the refresh. Read and preparation only: this barrel exports no
// send, export-to-third-party or filing function.
export { assembleBrief, type AssembleOptions } from './assemble.ts';
export {
  emptyMemoryProvider,
  type BriefActor,
  type BriefDeps,
  type BriefEvent,
  type BriefEvents,
  type BriefStaleReason,
  type CarryQuery,
  type CarryRule,
  type MemoryLine,
  type MemoryNote,
  type MemoryProvider,
  type MemoryQuery,
  type MemorySynopsis,
} from './scope.ts';
export {
  applyBriefFormat,
  createBriefMemoryProvider,
  type BriefMemoryProvider,
} from './memory-provider.ts';
export { computeReadiness } from './readiness.ts';
export { markPrepared, setBriefNote, setCarryItem, unmarkPrepared } from './state.ts';
export {
  onCourtDayListChanged,
  refreshBrief,
  refreshBriefTargets,
  type EnqueueRefresh,
  type RefreshResult,
  type RefreshTarget,
  type SweepDeps,
  type SweepReport,
} from './refresh.ts';
