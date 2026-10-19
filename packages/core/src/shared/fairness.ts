// Job fairness default shared by `jobs` (the worker cap) and `usage` (per-plan caps), #221, #293.
// Re-exported from `jobs/define.ts`.

/** Concurrent jobs per `fairnessKey` (default the workspace) across all workers. */
export const DEFAULT_FAIRNESS_CONCURRENCY = 3;
