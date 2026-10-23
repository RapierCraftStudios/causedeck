// The staff Data Ops read model (#514, D-048/D-049): per-source health over the content-free
// `fetch_log` and the source registry, with parse yield from `adapter_parse_run` through the staff
// definer function. Everything here is counts, ids, status, tier, cost and time; no URL, URL hash,
// advocate, document or party data ever leaves this module.
import { schema, withUser, type Queryable } from '@causedeck/db';
import { and, desc, eq, gte, max, sql } from 'drizzle-orm';

import { SourceAdminError, type SourceKind, type SourceMaxTier } from './registry.ts';

const { fetchLog, source } = schema;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** How stale a source may get before the console flags it: hours since the last successful fetch. */
export const FRESHNESS_SLA_HOURS: Readonly<Record<SourceKind, number>> = {
  court: 24,
  notice: 24,
  news: 6,
  licensed: 24,
  corpus: 168,
};

export type SourceOpsStatus = 'cleared' | 'not_cleared' | 'killed';

/** One source's counts over a window (24 hours or 7 days). */
export interface SourceOpsWindow {
  fetches: number;
  errors: number;
  /** errors / fetches; `null` with no fetches. */
  errorRate: number | null;
  costDollars: number;
  /** Calls that used the `captcha` tier, and how many of those succeeded. */
  captchaCalls: number;
  captchaSolveRate: number | null;
  tierMix: Record<SourceMaxTier, number>;
  /** Rows anchored / rows parsed by the source's adapter; `null` without parse runs. */
  parseYield: number | null;
}

export interface SourceOpsDay {
  /** UTC date, `YYYY-MM-DD`. */
  day: string;
  fetches: number;
  errors: number;
  costDollars: number;
}

export interface SourceOpsRow {
  id: string;
  kind: SourceKind;
  accessMode: schema.SourceAccessMode;
  status: SourceOpsStatus;
  lastSuccessAt: Date | null;
  /** Hours since the last success; `null` when there never was one. */
  freshnessHours: number | null;
  slaHours: number;
  /** Within the SLA. A source that never succeeded is not fresh. */
  fresh: boolean;
  day: SourceOpsWindow;
  week: SourceOpsWindow;
  /** The last 7 UTC days, oldest first, zero-filled. */
  daily: SourceOpsDay[];
}

export interface ParseYieldRow {
  adapterId: string;
  runs: number;
  rowsParsed: number;
  rowsAnchored: number;
}

/** Parse totals per adapter for the 24 hour and 7 day windows (adapter id = source id). */
export interface ParseYields {
  day: readonly ParseYieldRow[];
  week: readonly ParseYieldRow[];
}

/** One `fetch_log` row as the console may see it: no URL hash, no advocate. */
export interface SourceFetchLogEntry {
  id: string;
  fetchedAt: Date;
  status: number;
  tier: SourceMaxTier | null;
  costDollars: number;
}

const emptyMix = (): Record<SourceMaxTier, number> => ({
  http: 0,
  headless: 0,
  proxy: 0,
  captcha: 0,
});

const emptyWindow = (): SourceOpsWindow => ({
  fetches: 0,
  errors: 0,
  errorRate: null,
  costDollars: 0,
  captchaCalls: 0,
  captchaSolveRate: null,
  tierMix: emptyMix(),
  parseYield: null,
});

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

/** A failed call: the provider failed before a response (0) or the source answered 4xx/5xx. */
export const isFetchError = (status: number): boolean => status === 0 || status >= 400;

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

function lastSevenDays(now: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => dayKey(new Date(now.getTime() - (6 - i) * DAY_MS)));
}

/** Staff-only counts per adapter since `since`, via `app_staff_parse_yield` (refuses non-staff). */
export async function staffParseYield(
  db: Queryable,
  staffUserId: string,
  since: Date,
): Promise<ParseYieldRow[]> {
  try {
    const rows = await withUser(db, { userId: staffUserId }, (tx) =>
      tx.execute<{ adapter_id: string; runs: string; rows_parsed: string; rows_anchored: string }>(
        sql`select * from app_staff_parse_yield(${since.toISOString()}::timestamptz)`,
      ),
    );
    return rows.map((r) => ({
      adapterId: r.adapter_id,
      runs: Number(r.runs),
      rowsParsed: Number(r.rows_parsed),
      rowsAnchored: Number(r.rows_anchored),
    }));
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code;
    const causeCode = (error as { cause?: { code?: string } }).cause?.code;
    if (code === '42501' || causeCode === '42501') {
      throw new SourceAdminError('FORBIDDEN', 'Only enabled staff can read the Data Ops console');
    }
    throw error;
  }
}

/**
 * Every registered source (or just `sourceId`) with its 24 hour and 7 day health, ordered by id.
 * Reads the global tables `source` and `fetch_log` only.
 */
export async function sourceOpsOverview(
  db: Queryable,
  now: Date,
  parseYields: ParseYields = { day: [], week: [] },
  sourceId?: string,
): Promise<SourceOpsRow[]> {
  const since24 = new Date(now.getTime() - DAY_MS);
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const sources = await db
    .select({
      id: source.id,
      kind: source.kind,
      accessMode: source.accessMode,
      clearedAt: source.clearedAt,
      killSwitch: source.killSwitch,
    })
    .from(source)
    .where(sourceId === undefined ? undefined : eq(source.id, sourceId))
    .orderBy(source.id);

  const dayExpr = sql<string>`to_char(${fetchLog.fetchedAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const recentExpr = sql<boolean>`${fetchLog.fetchedAt} >= ${since24.toISOString()}::timestamptz`;
  const buckets = await db
    .select({
      sourceId: fetchLog.sourceId,
      tier: fetchLog.tier,
      day: dayExpr,
      recent: recentExpr,
      fetches: sql<number>`count(*)::int`,
      errors: sql<number>`(count(*) filter (where ${fetchLog.status} = 0 or ${fetchLog.status} >= 400))::int`,
      cost: sql<string>`coalesce(sum(${fetchLog.costDollars}), 0)::text`,
    })
    .from(fetchLog)
    .where(
      and(
        gte(fetchLog.fetchedAt, since7),
        sourceId === undefined ? undefined : eq(fetchLog.sourceId, sourceId),
      ),
    )
    .groupBy(fetchLog.sourceId, fetchLog.tier, dayExpr, recentExpr);

  const lastSuccess = await db
    .select({ sourceId: fetchLog.sourceId, at: max(fetchLog.fetchedAt) })
    .from(fetchLog)
    .where(
      and(
        sql`${fetchLog.status} >= 200 and ${fetchLog.status} < 400`,
        sourceId === undefined ? undefined : eq(fetchLog.sourceId, sourceId),
      ),
    )
    .groupBy(fetchLog.sourceId);
  const lastById = new Map(lastSuccess.map((r) => [r.sourceId, r.at]));

  const yieldOf = (rows: readonly ParseYieldRow[], id: string): number | null => {
    const row = rows.find((r) => r.adapterId === id);
    return row === undefined ? null : ratio(row.rowsAnchored, row.rowsParsed);
  };
  const days = lastSevenDays(now);

  return sources.map((s) => {
    const day = emptyWindow();
    const week = emptyWindow();
    const daily = new Map<string, SourceOpsDay>(
      days.map((d) => [d, { day: d, fetches: 0, errors: 0, costDollars: 0 }]),
    );
    const captchaOk = { day: 0, week: 0 };
    for (const b of buckets.filter((x) => x.sourceId === s.id)) {
      const cost = Number(b.cost);
      for (const [w, applies] of [
        [day, b.recent],
        [week, true],
      ] as const) {
        if (!applies) continue;
        w.fetches += b.fetches;
        w.errors += b.errors;
        w.costDollars += cost;
        if (b.tier !== null) w.tierMix[b.tier] += b.fetches;
        if (b.tier === 'captcha') w.captchaCalls += b.fetches;
      }
      if (b.tier === 'captcha') {
        const ok = b.fetches - b.errors;
        if (b.recent) captchaOk.day += ok;
        captchaOk.week += ok;
      }
      const point = daily.get(b.day);
      if (point !== undefined) {
        point.fetches += b.fetches;
        point.errors += b.errors;
        point.costDollars += cost;
      }
    }
    for (const [w, ok, rows] of [
      [day, captchaOk.day, parseYields.day],
      [week, captchaOk.week, parseYields.week],
    ] as const) {
      w.errorRate = ratio(w.errors, w.fetches);
      w.captchaSolveRate = ratio(ok, w.captchaCalls);
      w.parseYield = yieldOf(rows, s.id);
    }
    const lastSuccessAt = lastById.get(s.id) ?? null;
    const freshnessHours =
      lastSuccessAt === null ? null : (now.getTime() - lastSuccessAt.getTime()) / HOUR_MS;
    const slaHours = FRESHNESS_SLA_HOURS[s.kind];
    return {
      id: s.id,
      kind: s.kind,
      accessMode: s.accessMode,
      status: s.killSwitch ? 'killed' : s.clearedAt === null ? 'not_cleared' : 'cleared',
      lastSuccessAt,
      freshnessHours,
      slaHours,
      fresh: freshnessHours !== null && freshnessHours <= slaHours,
      day,
      week,
      daily: [...daily.values()],
    };
  });
}

/** The sources with errors in the last 24 hours, most errors first (at most `limit`). */
export function topFailingSources(rows: readonly SourceOpsRow[], limit = 5): SourceOpsRow[] {
  return rows
    .filter((r) => r.day.errors > 0)
    .sort((a, b) => b.day.errors - a.day.errors || a.id.localeCompare(b.id))
    .slice(0, limit);
}

/** A source's newest `fetch_log` rows (at most `limit`, up to 200): status, tier, cost and time only. */
export async function sourceFetchLogs(
  db: Queryable,
  sourceId: string,
  limit = 50,
): Promise<SourceFetchLogEntry[]> {
  const rows = await db
    .select({
      id: fetchLog.id,
      fetchedAt: fetchLog.fetchedAt,
      status: fetchLog.status,
      tier: fetchLog.tier,
      costDollars: fetchLog.costDollars,
    })
    .from(fetchLog)
    .where(eq(fetchLog.sourceId, sourceId))
    .orderBy(desc(fetchLog.fetchedAt), desc(fetchLog.id))
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200));
  return rows.map((r) => ({ ...r, costDollars: Number(r.costDollars) }));
}
