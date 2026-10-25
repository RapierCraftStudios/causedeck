// The memory domain (#72, ADR 0038): what the OS learned about one lawyer. Nothing is saved until a
// person confirms it; scope is enforced in SQL; values are envelope-encrypted with the workspace
// key; no memory describes a judge or a bench. UI is #73; consumers read through `memoryFor`.
export {
  acceptMemoryDraft,
  confirmMemory,
  createMemoryNote,
  deleteMemory,
  dismissMemoryProposal,
  editMemory,
  isMemoryPaused,
  pauseMemory,
  setMemoryPauseAll,
  setSharedWithChamber,
} from './confirm.ts';
export {
  embedMemoryItem,
  localMemoryEmbedder,
  purgeDeletedMemoryEmbeddings,
  purgeMemoryTargets,
  searchMatterMemory,
  type MemoryEmbedder,
} from './embedding.ts';
export { proposeFromCorrection, proposeFromEdit, proposeMemory } from './propose.ts';
export {
  memoryCitation,
  exportMemory,
  getMemory,
  listMemory,
  memoryFor,
  recordUsage,
  type MemoryCitation,
  type MemoryForOutput,
} from './read.ts';
export {
  monthlyReview,
  reviewMemoryTargets,
  MEMORY_STALE_AFTER_DAYS,
  tenureMetrics,
  type MonthlyReview,
  type TenureMetrics,
  type TenureWeek,
} from './review.ts';
export {
  canReadMemory,
  canWriteMemory,
  MEMORY_CLERK_LAYERS,
  type MemoryActor,
  type MemoryDeps,
  type ReadableFacts,
} from './scope.ts';
