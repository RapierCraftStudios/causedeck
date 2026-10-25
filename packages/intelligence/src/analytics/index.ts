// Court and process analytics (#512, D-049, D-050): how long matters of a type take to be listed,
// how often a hearing is adjourned, how long disposal takes and how many matters are pending, by
// forum, case type, stage and filing or hearing year. The data is the caller's own workspace (the
// query runs in its RLS transaction), and every figure is an aggregate: a metric with fewer than
// `MIN_CELL_SIZE` observations is withheld. The query selects no listing hall or composition
// column, no title column and no internal sitting store, and the guard test pins that.
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

type Db = Database | Transaction;

/** A metric with fewer observations than this is withheld (k-anonymity floor). */
export const MIN_CELL_SIZE = 5;

/** A stage label for a matter that has never been listed. */
export const UNLISTED_STAGE = 'unlisted';

export interface ProceedingFact {
  forumId: string;
  caseTypeCode: string;
  /** The normalised stage of the matter's first listing, or `UNLISTED_STAGE`. */
  stage: string;
  filedOn: string;
  firstListedOn: string | null;
  disposedOn: string | null;
}

export interface HearingFact {
  forumId: string;
  caseTypeCode: string;
  stage: string;
  heldOn: string;
  adjourned: boolean;
}

/** `value` is null and `n` is null when the metric is withheld for want of observations. */
export interface Metric {
  value: number | null;
  n: number | null;
}

export interface InsightCell {
  forumId: string;
  caseTypeCode: string;
  stage: string;
  /** The calendar year: filing year for matter metrics, hearing year for the adjournment rate. */
  period: string;
  listingDelayDays: Metric;
  adjournmentRate: Metric;
  disposalDays: Metric;
  backlog: Metric;
  /** True when every metric of the cell is withheld. */
  suppressed: boolean;
}

export interface SummariseOptions {
  minCell?: number;
}

const DAY_MS = 86_400_000;

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return ((sorted[Math.floor(mid)] ?? 0) + (sorted[Math.ceil(mid)] ?? 0)) / 2;
}

const withheld: Metric = { value: null, n: null };

function metric(values: readonly number[], minCell: number, reduce: (v: number[]) => number) {
  if (values.length === 0 || values.length < minCell) return withheld;
  return { value: reduce([...values]), n: values.length } satisfies Metric;
}

const keyOf = (f: { forumId: string; caseTypeCode: string; stage: string }, period: string) =>
  JSON.stringify([f.forumId, f.caseTypeCode, f.stage, period]);

interface Bucket {
  forumId: string;
  caseTypeCode: string;
  stage: string;
  period: string;
  delays: number[];
  disposals: number[];
  pending: number[];
  adjourned: number[];
}

/** Aggregate the facts into cells, withholding every metric below the minimum cell size. */
export function summariseCells(
  proceedings: readonly ProceedingFact[],
  hearings: readonly HearingFact[],
  options: SummariseOptions = {},
): InsightCell[] {
  const minCell = options.minCell ?? MIN_CELL_SIZE;
  const buckets = new Map<string, Bucket>();
  const bucket = (
    f: { forumId: string; caseTypeCode: string; stage: string },
    period: string,
  ): Bucket => {
    const key = keyOf(f, period);
    let found = buckets.get(key);
    if (found === undefined) {
      found = {
        forumId: f.forumId,
        caseTypeCode: f.caseTypeCode,
        stage: f.stage,
        period,
        delays: [],
        disposals: [],
        pending: [],
        adjourned: [],
      };
      buckets.set(key, found);
    }
    return found;
  };
  for (const p of proceedings) {
    const b = bucket(p, p.filedOn.slice(0, 4));
    if (p.firstListedOn !== null)
      b.delays.push(Math.max(0, daysBetween(p.filedOn, p.firstListedOn)));
    if (p.disposedOn === null) b.pending.push(1);
    else b.disposals.push(Math.max(0, daysBetween(p.filedOn, p.disposedOn)));
  }
  for (const h of hearings) bucket(h, h.heldOn.slice(0, 4)).adjourned.push(h.adjourned ? 1 : 0);

  return [...buckets.values()]
    .map((b) => {
      const listingDelayDays = metric(b.delays, minCell, median);
      const adjournmentRate = metric(
        b.adjourned,
        minCell,
        (v) => v.reduce((a, c) => a + c, 0) / v.length,
      );
      const disposalDays = metric(b.disposals, minCell, median);
      const backlog = metric(b.pending, minCell, (v) => v.length);
      return {
        forumId: b.forumId,
        caseTypeCode: b.caseTypeCode,
        stage: b.stage,
        period: b.period,
        listingDelayDays,
        adjournmentRate,
        disposalDays,
        backlog,
        suppressed: [listingDelayDays, adjournmentRate, disposalDays, backlog].every(
          (m) => m.value === null,
        ),
      };
    })
    .sort((a, b) => keyOf(a, a.period).localeCompare(keyOf(b, b.period)));
}

export interface CourtInsightsQuery {
  /** Filing date (matters) and hearing date (hearings) window, `YYYY-MM-DD`, inclusive. */
  from: string;
  to: string;
  forumId?: string | undefined;
  caseTypeCode?: string | undefined;
}

export interface CourtInsights {
  window: { from: string; to: string };
  /** The floor under which a metric is withheld, for the page to state. */
  minCell: number;
  coverage: { proceedings: number; hearings: number };
  forums: { id: string; code: string; court: string }[];
  cells: InsightCell[];
}

const isoDate = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString().slice(0, 10);

/** The workspace's court insights. Run it inside the workspace's RLS transaction. */
export async function getCourtInsights(db: Db, query: CourtInsightsQuery): Promise<CourtInsights> {
  const { proceeding, listing, hearing, proceedingStateChange, forum } = schema;
  const scope = (filedOn: typeof proceeding.filingDate) =>
    and(
      gte(filedOn, query.from),
      lte(filedOn, query.to),
      query.forumId === undefined ? undefined : eq(proceeding.forumId, query.forumId),
      query.caseTypeCode === undefined
        ? undefined
        : eq(proceeding.caseTypeCode, query.caseTypeCode),
    );

  const matters = await db
    .select({
      id: proceeding.id,
      forumId: proceeding.forumId,
      caseTypeCode: proceeding.caseTypeCode,
      filedOn: proceeding.filingDate,
    })
    .from(proceeding)
    .where(scope(proceeding.filingDate));

  const listed = await db
    .select({
      proceedingId: listing.proceedingId,
      listDate: listing.listDate,
      stage: listing.stageNorm,
    })
    .from(listing)
    .innerJoin(proceeding, eq(proceeding.id, listing.proceedingId))
    .where(scope(proceeding.filingDate))
    .orderBy(asc(listing.listDate));

  const disposals = await db
    .select({
      proceedingId: proceedingStateChange.proceedingId,
      changedAt: proceedingStateChange.changedAt,
    })
    .from(proceedingStateChange)
    .innerJoin(proceeding, eq(proceeding.id, proceedingStateChange.proceedingId))
    .where(and(scope(proceeding.filingDate), eq(proceedingStateChange.toState, 'disposed')))
    .orderBy(asc(proceedingStateChange.changedAt));

  const held = await db
    .select({
      proceedingId: listing.proceedingId,
      heldOn: hearing.heldOn,
      adjournmentReason: hearing.adjournmentReason,
      stage: listing.stageNorm,
    })
    .from(hearing)
    .innerJoin(listing, eq(listing.id, hearing.listingId))
    .innerJoin(proceeding, eq(proceeding.id, listing.proceedingId))
    .where(
      and(
        gte(hearing.heldOn, query.from),
        lte(hearing.heldOn, query.to),
        scope(proceeding.filingDate),
      ),
    );

  const firstListing = new Map<string, { listDate: string; stage: string }>();
  for (const row of listed) {
    if (!firstListing.has(row.proceedingId)) {
      firstListing.set(row.proceedingId, {
        listDate: row.listDate,
        stage: row.stage ?? UNLISTED_STAGE,
      });
    }
  }
  const disposedOn = new Map<string, string>();
  for (const row of disposals) {
    // The last disposal wins: a reopened matter that was disposed again.
    disposedOn.set(row.proceedingId, isoDate(row.changedAt));
  }
  const byId = new Map(matters.map((m) => [m.id, m]));

  const proceedingFacts: ProceedingFact[] = [];
  for (const m of matters) {
    if (m.filedOn === null) continue;
    const first = firstListing.get(m.id);
    proceedingFacts.push({
      forumId: m.forumId,
      caseTypeCode: m.caseTypeCode,
      stage: first?.stage ?? UNLISTED_STAGE,
      filedOn: m.filedOn,
      firstListedOn: first?.listDate ?? null,
      disposedOn: disposedOn.get(m.id) ?? null,
    });
  }
  const hearingFacts: HearingFact[] = [];
  for (const h of held) {
    const m = byId.get(h.proceedingId);
    if (m === undefined) continue;
    hearingFacts.push({
      forumId: m.forumId,
      caseTypeCode: m.caseTypeCode,
      stage: h.stage ?? UNLISTED_STAGE,
      heldOn: h.heldOn,
      adjourned: h.adjournmentReason !== null,
    });
  }

  const forumIds = [...new Set(proceedingFacts.map((f) => f.forumId))];
  const forumRows =
    forumIds.length === 0
      ? []
      : await db.select({ id: forum.id, code: forum.code, court: forum.court }).from(forum);
  return {
    window: { from: query.from, to: query.to },
    minCell: MIN_CELL_SIZE,
    coverage: { proceedings: proceedingFacts.length, hearings: hearingFacts.length },
    forums: forumRows.filter((f) => forumIds.includes(f.id)),
    cells: summariseCells(proceedingFacts, hearingFacts),
  };
}
