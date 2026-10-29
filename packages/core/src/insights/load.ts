// The load series (#85): the weekly 3-item pulse (#86: demand, worry, effort), by ISO week, with
// the baseline and the delta; hidden below `INSIGHTS_MIN_N` answered pulses. A dismissed pulse is
// not an answer. A junior sees only their own pulses.
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import {
  INSIGHTS_MIN_N,
  InsightsQuery,
  type InsightsWindow,
  type LoadSeries,
} from '@causedeck/validators/insights';
import { and, eq, gte, isNotNull, lt } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';
import { povIstDay } from '../pov/index.ts';

import { insightsViewer, type InsightsActor, type InsightsDeps } from './access.ts';
import { byWeek, mean, round1 } from './preparedness.ts';
import { istEnd, istStart, resolveWindow } from './range.ts';

const { loadPulse } = schema;

export async function loadIn(
  tx: Transaction,
  workspaceId: string,
  memberId: string | null,
  window: InsightsWindow,
): Promise<LoadSeries> {
  const mine = memberId === null ? [] : [eq(loadPulse.memberId, memberId)];
  const answered = [eq(loadPulse.workspaceId, workspaceId), isNotNull(loadPulse.demand), ...mine];
  const rows = await tx
    .select({
      week: loadPulse.isoWeek,
      demand: loadPulse.demand,
      worry: loadPulse.worry,
      effort: loadPulse.effort,
    })
    .from(loadPulse)
    .where(
      and(
        ...answered,
        // The pulse is stamped when answered; the week is the ISO week of that day.
        gte(loadPulse.createdAt, istStart(window.from)),
        lt(loadPulse.createdAt, istEnd(window.to)),
      ),
    );
  const baseline = await tx
    .select({ demand: loadPulse.demand, worry: loadPulse.worry, effort: loadPulse.effort })
    .from(loadPulse)
    .where(and(...answered, eq(loadPulse.baseline, true)));
  const pulses = rows.map((r) => ({
    week: r.week,
    demand: r.demand as number,
    worry: r.worry as number,
    effort: r.effort as number,
  }));
  if (pulses.length < INSIGHTS_MIN_N)
    return {
      window,
      n: pulses.length,
      hidden: true,
      demand: null,
      worry: null,
      effort: null,
      delta: null,
      baselineAverage: null,
      points: [],
    };
  const overall = (list: readonly { demand: number; worry: number; effort: number }[]) =>
    mean(list.flatMap((p) => [p.demand, p.worry, p.effort]));
  const average = overall(pulses);
  const baselineAverage = overall(
    baseline.map((p) => ({
      demand: p.demand as number,
      worry: p.worry as number,
      effort: p.effort as number,
    })),
  );
  return {
    window,
    n: pulses.length,
    hidden: false,
    demand: mean(pulses.map((p) => p.demand)),
    worry: mean(pulses.map((p) => p.worry)),
    effort: mean(pulses.map((p) => p.effort)),
    baselineAverage,
    delta: average !== null && baselineAverage !== null ? round1(average - baselineAverage) : null,
    points: byWeek(pulses).map(([week, list]) => ({
      week,
      n: list.length,
      demand: mean(list.map((p) => p.demand)),
      worry: mean(list.map((p) => p.worry)),
      effort: mean(list.map((p) => p.effort)),
    })),
  };
}

/** The weekly load pulses of the range, within the actor's workspace (a junior: their own). */
export async function loadSeries(
  deps: InsightsDeps,
  actor: InsightsActor,
  input: unknown,
): Promise<LoadSeries> {
  const parsed = InsightsQuery.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid range');
  const viewer = await insightsViewer(deps, actor, parsed.data.memberId);
  const window = resolveWindow(parsed.data, povIstDay((deps.now ?? (() => new Date()))()));
  return withWorkspace(deps.db, actor, (tx) => loadIn(tx, actor.workspaceId, viewer.memberId, window));
}
