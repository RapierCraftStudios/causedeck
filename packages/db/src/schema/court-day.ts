// Court-day state (#58): `court_day_marker` is the lawyer's manual "court is at item N" note for one
// hall and date (live display-board tracking lives in `board_observation`; this is an internal note
// and never changes a listing), and `list_snapshot` is the immutable record of each list ingestion
// (hash plus rows) that `diffLists` compares. Both are tenant tables under FORCE RLS.
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
  index,
  date,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';
import { capture } from './capture.ts';
import { courtHall, forum } from './court.ts';
import { listType } from './enums.ts';

/** One row of a stored list; item numbers stay text as printed. */
export interface ListSnapshotRow {
  proceedingKey: string;
  hallNo: string | null;
  itemNo: string | null;
  stage: string | null;
}

export const courtDayMarker = tenantTable(
  'court_day_marker',
  {
    id: id(),
    hallId: uuid('hall_id')
      .notNull()
      .references(() => courtHall.id, { onDelete: 'cascade' }),
    listDate: date('list_date').notNull(),
    currentItem: integer('current_item').notNull(),
    setBy: uuid('set_by').references(() => user.id, { onDelete: 'set null' }),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (t) => [
    unique('court_day_marker_workspace_hall_date_uq').on(t.workspaceId, t.hallId, t.listDate),
    foreignKey({
      name: 'court_day_marker_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('court_day_marker_item_chk', sql`${t.currentItem} > 0`),
  ],
);

export const listSnapshot = tenantTable(
  'list_snapshot',
  {
    id: id(),
    forumId: uuid('forum_id')
      .notNull()
      .references(() => forum.id, { onDelete: 'restrict' }),
    listDate: date('list_date').notNull(),
    listType: listType('list_type').notNull(),
    contentHash: text('content_hash').notNull(),
    rows: jsonb('rows').$type<ListSnapshotRow[]>().notNull(),
    sourceCaptureId: uuid('source_capture_id'),
    ...timestamps(),
  },
  (t) => [
    unique('list_snapshot_workspace_list_hash_uq').on(
      t.workspaceId,
      t.forumId,
      t.listDate,
      t.listType,
      t.contentHash,
    ),
    index('list_snapshot_workspace_list_idx').on(t.workspaceId, t.forumId, t.listDate, t.createdAt),
    foreignKey({
      name: 'list_snapshot_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'list_snapshot_source_capture_fk',
      columns: [t.workspaceId, t.sourceCaptureId],
      foreignColumns: [capture.workspaceId, capture.id],
    }),
  ],
);
