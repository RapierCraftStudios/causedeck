// The preparedness series (#85): the one-tap 1-5 ratings (#86) by ISO week with the baseline (the
// workspace's first 7 days) and the delta. Below `INSIGHTS_MIN_N` ratings the numbers are withheld
// so a handful of taps never reads as a trend. A junior sees only their own ratings.
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import {
  INSIGHTS_MIN_N,
  InsightsQuery,
  type InsightsWindow,
  type PreparednessSeries,
} from '@causedeck/validators/insights';
import { and, eq, gte, isNotNull, lt } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';
import { isoWeekIst, povIstDay } from '../pov/index.ts';

import { insightsViewer, type InsightsActor, type InsightsDeps } from './access.ts';
import { istEnd, istStart, resolveWindow } from './range.ts';

const { preparednessRating } = schema;

/** One decimal. */
export const round1 = (value: number): number => Math.round(value * 10) / 10;

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : round1(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Group `rows` by week, in week order. */
export function byWeek<T extends { week: string }>(rows: readonly T[]): [string, T[]][] {
  const weeks = new Map<string, T[]>();
  for (const row of rows) weeks.set(row.week, [...(weeks.get(row.week) ?? []), row]);
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export async function preparednessIn(
  tx: Transaction,
  workspaceId: string,
  memberId: string | null,
  window: InsightsWindow,
): Promise<PreparednessSeries> {
  const mine = memberId === null ? [] : [eq(preparednessRating.memberId, memberId)];
  const rows = await tx
    .select({ rating: preparednessRating.rating, at: preparednessRating.createdAt })
    .from(preparednessRating)
    .where(
      and(
        eq(preparednessRating.workspaceId, workspaceId),
        isNotNull(preparednessRating.rating),
        gte(preparednessRating.createdAt, istStart(window.from)),
        lt(preparednessRating.createdAt, istEnd(window.to)),
        ...mine,
      ),
    );
  const baseline = await tx
    .select({ rating: preparednessRating.rating })
    .from(preparednessRating)
    .where(
      and(
        eq(preparednessRating.workspaceId, workspaceId),
        isNotNull(preparednessRating.rating),
        eq(preparednessRating.baseline, true),
        ...mine,
      ),
    );
  const ratings = rows.map((r) => ({ week: isoWeekIst(r.at), rating: r.rating as number }));
  if (ratings.length < INSIGHTS_MIN_N)
    return {
      window,
      n: ratings.length,
      hidden: true,
      average: null,
      baselineAverage: null,
      delta: null,
      points: [],
    };
  const average = mean(ratings.map((r) => r.rating));
  const baselineAverage = mean(baseline.map((r) => r.rating as number));
  return {
    window,
    n: ratings.length,
    hidden: false,
    average,
    baselineAverage,
    delta: average !== null && baselineAverage !== null ? round1(average - baselineAverage) : null,
    points: byWeek(ratings).map(([week, list]) => ({
      week,
      n: list.length,
      average: mean(list.map((r) => r.rating)),
    })),
  };
}

/** The preparedness ratings of the range, within the actor's workspace (a junior: their own). */
export async function preparednessSeries(
  deps: InsightsDeps,
  actor: InsightsActor,
  input: unknown,
): Promise<PreparednessSeries> {
  const parsed = InsightsQuery.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'Invalid range');
  const viewer = await insightsViewer(deps, actor, parsed.data.memberId);
  const window = resolveWindow(parsed.data, povIstDay((deps.now ?? (() => new Date()))()));
  return withWorkspace(deps.db, actor, (tx) =>
    preparednessIn(tx, actor.workspaceId, viewer.memberId, window),
  );
}
