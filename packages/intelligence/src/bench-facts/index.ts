// Internal bench facts (#521, D-050): aggregation of display-board observations (and, through the
// owner-defined roster lookup, the active roster bench of a hall) into neutral per-hall, per-day
// counts and pace: items listed, heard and disposed, and minutes per item. The result goes only to
// the staff-only `bench_sitting_fact` store through `app_bench_fact_record`; the app role has no
// table grant. Facts are counts and minutes: nothing here rates, ranks or compares benches or
// judges, and nothing derives an outcome rate or a prediction (D-050; pinned by static-guard.test.ts).
import { schema, type Database, type Transaction } from '@causedeck/db';
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';

type Db = Database | Transaction;

export interface HallObservation {
  itemNo: string | null;
  status: 'sitting' | 'risen' | 'passed_over' | 'lunch';
  passedOver: readonly string[];
  observedAt: Date;
}

export interface HallDayFacts {
  itemsListed: number;
  itemsHeard: number;
  itemsDisposed: number;
  /** Median minutes per item over the day; null with fewer than `MIN_PACE_SAMPLES` samples. */
  minutesPerItem: number | null;
}

/** A gap longer than this between two observations is a break, not a pace sample. */
const MAX_SAMPLE_MINUTES = 180;
export const MIN_PACE_SAMPLES = 2;

const itemNumber = (itemNo: string | null): number | null => {
  if (itemNo === null) return null;
  const match = /^\d+/.exec(itemNo.trim());
  return match === null ? null : Number(match[0]);
};

const istDay = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(at);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = (sorted.length - 1) / 2;
  return ((sorted[Math.floor(mid)] ?? 0) + (sorted[Math.ceil(mid)] ?? 0)) / 2;
}

/**
 * The facts of one hall on one day from its observations. Heard items are the distinct item numbers
 * seen while the hall was sitting; disposed are heard items the board never passed over; listed is
 * the highest item number seen (or `listed`, when a caller knows more), never below heard.
 */
export function summariseHallDay(
  observations: readonly HallObservation[],
  listed?: number,
): HallDayFacts {
  const ordered = [...observations].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const heard = new Set<number>();
  const passed = new Set<number>();
  let highest = 0;
  for (const obs of ordered) {
    const now = itemNumber(obs.itemNo);
    if (obs.status === 'sitting' && now !== null) {
      heard.add(now);
      highest = Math.max(highest, now);
    }
    for (const item of obs.passedOver) {
      const n = itemNumber(item);
      if (n !== null) passed.add(n);
    }
  }
  const disposed = [...heard].filter((n) => !passed.has(n)).length;

  const samples: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const before = ordered[i - 1];
    const after = ordered[i];
    if (before === undefined || after === undefined) continue;
    if (before.status !== 'sitting' || after.status !== 'sitting') continue;
    const a = itemNumber(before.itemNo);
    const b = itemNumber(after.itemNo);
    if (a === null || b === null || b <= a) continue;
    const minutes = (after.observedAt.getTime() - before.observedAt.getTime()) / 60_000;
    if (minutes <= 0 || minutes > MAX_SAMPLE_MINUTES) continue;
    samples.push(minutes / (b - a));
  }
  return {
    itemsListed: Math.max(listed ?? 0, highest, heard.size),
    itemsHeard: heard.size,
    itemsDisposed: disposed,
    minutesPerItem:
      samples.length >= MIN_PACE_SAMPLES ? Math.round(median(samples) * 100) / 100 : null,
  };
}

export type RosterHall = {
  forum_code: string;
  hall_no: string;
  bench_id: string;
};

/** The roster bench covering a hall, or null: only a single active, confirmed roster bench counts. */
export function benchForHall(
  rows: readonly RosterHall[],
  forumPrefix: string,
  hallNo: string,
): string | null {
  const benches = new Set(
    rows
      .filter((r) => r.forum_code.startsWith(forumPrefix) && r.hall_no === hallNo)
      .map((r) => r.bench_id),
  );
  return benches.size === 1 ? ([...benches][0] ?? null) : null;
}

/** Store one hall-day's facts through the owner-defined writer (the app role has no table grant). */
export async function recordBenchFacts(
  db: Db,
  input: { sourceId: string; hallNo: string; sittingDate: string; benchId: string | null } & {
    facts: HallDayFacts;
  },
): Promise<void> {
  const { facts } = input;
  await db.execute(
    sql`select app_bench_fact_record(${input.sourceId}, ${input.hallNo}, ${input.sittingDate}::date, ${input.benchId}::uuid, ${facts.itemsListed}, ${facts.itemsHeard}, ${facts.itemsDisposed}, ${facts.minutesPerItem}::numeric)`,
  );
}

/** Recompute and store today's facts for the given halls of one display board. */
export async function refreshBenchFacts(
  db: Db,
  input: { sourceId: string; forumPrefix: string; hallNos: readonly string[]; now: Date },
): Promise<number> {
  const day = istDay(input.now);
  const from = new Date(`${day}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 24 * 3_600_000);
  const rosterRows = await db.execute<RosterHall>(
    sql`select forum_code, hall_no, bench_id::text from app_bench_for_halls(${day}::date)`,
  );
  const { boardObservation } = schema;
  let stored = 0;
  for (const hallNo of input.hallNos) {
    const rows = await db
      .select()
      .from(boardObservation)
      .where(
        and(
          eq(boardObservation.sourceId, input.sourceId),
          eq(boardObservation.hallNo, hallNo),
          gte(boardObservation.observedAt, from),
          lt(boardObservation.observedAt, to),
        ),
      )
      .orderBy(asc(boardObservation.observedAt));
    if (rows.length === 0) continue;
    await recordBenchFacts(db, {
      sourceId: input.sourceId,
      hallNo,
      sittingDate: day,
      benchId: benchForHall(rosterRows, input.forumPrefix, hallNo),
      facts: summariseHallDay(rows),
    });
    stored += 1;
  }
  return stored;
}

/** Median minutes per item, per day, from the stored facts (the internal pace history of a hall). */
export async function loadBenchPace(
  db: Db,
  input: { sourceId: string; hallNo: string; since: Date },
): Promise<number[]> {
  const rows = await db.execute<{ minutes_per_item: string }>(
    sql`select minutes_per_item::text from app_bench_pace(${input.sourceId}, ${input.hallNo}, ${istDay(input.since)}::date)`,
  );
  return rows.map((r) => Number(r.minutes_per_item)).filter((n) => Number.isFinite(n) && n > 0);
}
