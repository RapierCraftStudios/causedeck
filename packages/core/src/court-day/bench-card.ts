// The matter's bench card (#521, D-050): neutral, verifiable facts about the bench that last listed
// a proceeding: who sat (the court-published composition), the sitting dates and halls, the listing
// pace and the counts of items listed, heard and disposed. It is read from the staff-only
// `bench_sitting_fact` store only through `app_bench_card` (the app role has no table grant), and
// only while the legal-gated flag `bench_facts` is on for the workspace; with the flag off (the
// default, until counsel clears it, #118) nothing is read and nothing is returned. Facts only: no
// score, ordering of benches or outcome figure exists to return.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

const { bench, listing, proceeding } = schema;

export const BENCH_FACTS_FLAG = 'bench_facts';

/** How many days of sittings the card lists. */
const CARD_DAYS = 90;

export interface BenchCardSitting {
  sittingDate: string;
  hallNo: string;
  itemsListed: number;
  itemsHeard: number;
  itemsDisposed: number;
  minutesPerItem: number | null;
}

export interface BenchCard {
  benchId: string;
  /** The composition as the court publishes it. */
  sat: string[];
  sittings: BenchCardSitting[];
}

export interface BenchCardDeps {
  db: Database | Transaction;
  clock?: { now(): Date };
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
}

type CardRow = {
  sitting_date: string;
  hall_no: string;
  items_listed: number;
  items_heard: number;
  items_disposed: number;
  minutes_per_item: string | null;
};

/** The bench card of a matter (its latest listed bench), or null when the flag is off or no bench is known. */
export async function getBenchCard(
  deps: BenchCardDeps,
  actor: { workspaceId: string; userId: string },
  matterId: string,
): Promise<BenchCard | null> {
  const flag = deps.flagEnabled ?? ((id) => isEnabled(BENCH_FACTS_FLAG, { workspaceId: id }));
  if (!(await flag(actor.workspaceId))) return null;

  const [latest] = await withWorkspace(deps.db, actor, (tx) =>
    tx
      .select({ benchId: bench.id, sat: bench.judges })
      .from(listing)
      .innerJoin(bench, eq(bench.id, listing.benchId))
      .innerJoin(proceeding, eq(proceeding.id, listing.proceedingId))
      .where(and(eq(proceeding.matterId, matterId), isNotNull(listing.benchId)))
      .orderBy(desc(listing.listDate))
      .limit(1),
  );
  if (latest === undefined) return null;

  const since = new Date((deps.clock?.now() ?? new Date()).getTime() - CARD_DAYS * 24 * 3_600_000);
  const rows = await deps.db.execute<CardRow>(
    sql`select sitting_date::text, hall_no, items_listed, items_heard, items_disposed, minutes_per_item::text from app_bench_card(${latest.benchId}::uuid, ${since.toISOString().slice(0, 10)}::date)`,
  );
  return {
    benchId: latest.benchId,
    sat: latest.sat,
    sittings: rows.map((r) => ({
      sittingDate: r.sitting_date,
      hallNo: r.hall_no,
      itemsListed: r.items_listed,
      itemsHeard: r.items_heard,
      itemsDisposed: r.items_disposed,
      minutesPerItem: r.minutes_per_item === null ? null : Number(r.minutes_per_item),
    })),
  };
}
