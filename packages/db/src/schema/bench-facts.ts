// Internal bench facts (#521, D-050). `bench_sitting_fact` is global and staff-only: one row per
// source, hall and sitting date with the neutral counts a display board and a roster support
// (items listed, heard, disposed, minutes per item), tied to a bench when exactly one active
// roster bench covers the hall. It is data for building and quality (call-time estimates, roster
// reconciliation, coverage), never a user-facing table: the bench_facts migration revokes every grant from the
// app and clerk roles, and the only way in or out is the owner-defined `app_bench_*` functions. It
// holds no judge, party, case or outcome column and no rate, ranking or score; the court-published
// composition stays only in `bench.judges` (PX-9, ME-6; D-050 prohibits ratings, rankings,
// comparisons, outcome rates, predictions and sentiment at any stage).
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const benchSittingFact = pgTable(
  'bench_sitting_fact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Null when no single active roster bench covers the hall that day. A plain id, not an FK: the
     * table is global and a tenant FK would need a workspace scope guard it cannot have.
     */
    benchId: uuid('bench_id'),
    /** The `source.id` of the display board the counts come from. */
    sourceId: text('source_id').notNull(),
    hallNo: text('hall_no').notNull(),
    sittingDate: date('sitting_date').notNull(),
    itemsListed: integer('items_listed').notNull(),
    itemsHeard: integer('items_heard').notNull(),
    itemsDisposed: integer('items_disposed').notNull(),
    /** Median minutes per item over the day's sitting observations; null when too few samples. */
    minutesPerItem: numeric('minutes_per_item', { precision: 8, scale: 2 }),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('bench_sitting_fact_hall_day_uq').on(t.sourceId, t.hallNo, t.sittingDate),
    index('bench_sitting_fact_bench_idx').on(t.benchId, t.sittingDate),
    check(
      'bench_sitting_fact_counts_chk',
      sql`items_listed >= 0 and items_heard >= 0 and items_disposed >= 0 and items_heard <= items_listed and items_disposed <= items_heard`,
    ),
  ],
);
