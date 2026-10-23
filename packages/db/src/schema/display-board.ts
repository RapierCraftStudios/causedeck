// Court display-board observations (#493, D-048). `board_observation` is global and content-free:
// one row each time a hall's board changes (hall, item now being heard, state, items passed over),
// shared by every workspace so one fetch serves every watcher. It holds no party, case or advocate,
// and it is the pace history behind the call-time estimate (median minutes per item in that hall).
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const BOARD_OBSERVATION_STATUSES = ['sitting', 'risen', 'passed_over', 'lunch'] as const;
export type BoardObservationStatus = (typeof BOARD_OBSERVATION_STATUSES)[number];

export const boardObservation = pgTable(
  'board_observation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The `source.id` of the board (`in.ka.karnataka-hc.bengaluru:display_board`). */
    sourceId: text('source_id').notNull(),
    hallNo: text('hall_no').notNull(),
    /** The item now being heard; null when the hall shows none. */
    itemNo: text('item_no'),
    status: text('status').$type<BoardObservationStatus>().notNull(),
    passedOver: text('passed_over')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('board_observation_hall_idx').on(t.sourceId, t.hallNo, t.observedAt),
    check(
      'board_observation_status_chk',
      sql`status in ('sitting', 'risen', 'passed_over', 'lunch')`,
    ),
  ],
);
