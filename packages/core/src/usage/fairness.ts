// Job-queue fairness per plan (#221, #30 part 4). The #15 worker caps concurrent jobs per fairness
// group (the workspace unless a job sets `fairnessKey`) at the job's `fairnessConcurrency`; for
// workspace groups it further lowers the cap to the workspace plan's default here, so a free
// workspace cannot crowd paying ones out of a queue. Downgraded workspaces resolve to Junior.
import { getPlan, type PlanKind } from '@causedeck/billing';
import { withWorkspace, type Queryable } from '@causedeck/db';

import { getWorkspaceEntitlements } from '../billing/entitlements.ts';
import { DEFAULT_FAIRNESS_CONCURRENCY } from '../jobs/define.ts';

/** Concurrent jobs per workspace and queue, by plan; each in [1, DEFAULT_FAIRNESS_CONCURRENCY]. */
export const FAIRNESS_CONCURRENCY_BY_PLAN: Readonly<Record<PlanKind, number>> = Object.freeze({
  junior: 1,
  advocate: 2,
  chamber: DEFAULT_FAIRNESS_CONCURRENCY,
  dedicated: DEFAULT_FAIRNESS_CONCURRENCY,
});

/** The plan's default; an unknown plan id is treated as Junior. */
export function fairnessConcurrencyForPlan(planId: string): number {
  return FAIRNESS_CONCURRENCY_BY_PLAN[getPlan(planId)?.kind ?? 'junior'];
}

/** The workspace's per-queue concurrency default, from its (cached) entitlements. */
export async function getWorkspaceFairnessConcurrency(
  db: Queryable,
  workspaceId: string,
  now: Date = new Date(),
): Promise<number> {
  const entitlements = await withWorkspace(db, { workspaceId }, (tx) =>
    getWorkspaceEntitlements(tx, workspaceId, now),
  );
  return fairnessConcurrencyForPlan(entitlements.planId);
}
