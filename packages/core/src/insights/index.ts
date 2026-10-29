// Practice insights (#85): the lawyer's own practice report, computed within the workspace from its
// own hearings, brief state, obligations and the proof-of-value measures (#86). Owner and advocates
// read workspace totals; a junior only their own; a clerk or viewer none. There is no comparison
// across lawyers or workspaces and no bench or judge dimension (a static test guards it).
import { withWorkspace } from '@causedeck/db';
import { InsightsQuery, type PracticeInsights } from '@causedeck/validators/insights';

import { invalid } from '../shared/errors.ts';
import { povIstDay } from '../pov/index.ts';

import { insightsViewer, type InsightsActor, type InsightsDeps } from './access.ts';
import { loadIn } from './load.ts';
import { obligationHealthIn } from './obligations.ts';
import { preparednessIn } from './preparedness.ts';
import { preparedKeptIn } from './prepared-kept.ts';
import { resolveWindow } from './range.ts';

export { computePreparedKept } from './prepared-kept.ts';
export { obligationHealth } from './obligations.ts';
export { preparednessSeries } from './preparedness.ts';
export { loadSeries } from './load.ts';
export type { InsightsActor, InsightsDeps } from './access.ts';

/** Everything the dashboard and the printable report show, in one workspace transaction. */
export async function getPracticeInsights(
  deps: InsightsDeps,
  actor: InsightsActor,
  input: unknown = {},
): Promise<PracticeInsights> {
  const parsed = InsightsQuery.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid range');
  const viewer = await insightsViewer(deps, actor, parsed.data.memberId);
  const now = (deps.now ?? (() => new Date()))();
  const today = povIstDay(now);
  const window = resolveWindow(parsed.data, today);
  return withWorkspace(deps.db, actor, async (tx) => ({
    computedAt: now.toISOString(),
    scope: viewer.scope,
    preparedKept: await preparedKeptIn(tx, actor.workspaceId, viewer.memberId, window, today),
    obligations: await obligationHealthIn(tx, actor.workspaceId, viewer.memberId, window, today),
    preparedness: await preparednessIn(tx, actor.workspaceId, viewer.memberId, window),
    load: await loadIn(tx, actor.workspaceId, viewer.memberId, window),
  }));
}
