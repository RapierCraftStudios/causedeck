// Outward update drafts (#735, ADR 0045): `@causedeck/core/outward`. A draft is prepared from
// confirmed facts, edited and shared by the lawyer; there is no send path.
export { composeUpdate, type ComposedDraft } from './compose.ts';
export { diffDraft, saveEdit, type DiffPart, type SavedEdit } from './diff.ts';
export {
  GUARD_CATEGORIES,
  GUARD_PHRASES,
  guardOutward,
  type GuardCategory,
  type GuardResult,
  type GuardViolation,
} from './guard.ts';
export type { OutwardActor, OutwardDeps } from './context.ts';
export { recordCopied, recordShared, type SharedRecord } from './share.ts';
export { getDraft, listDrafts, type DraftDetail, type DraftSummary } from './views.ts';
