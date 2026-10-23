// Court cause-list watches (#482, D-048 tier 2, D-028 A2). `cause_list_watch` is a tenant table: the
// advocate name or BRN a member wants watched on a public list source. `cause_list_publication` is
// global and content-free: one row per fetched publication (URL, fetch time, sha256, row count),
// shared by every workspace so one fetch serves everyone. It never holds the list body or any row,
// so another advocate's row is not stored (matched-only rule, docs/product/09 §8.4).
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';

export const CAUSE_LIST_WATCH_KINDS = ['name', 'brn'] as const;
export type CauseListWatchKind = (typeof CAUSE_LIST_WATCH_KINDS)[number];

export const causeListWatch = tenantTable(
  'cause_list_watch',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The `source.id` of the list watched (`in.ka.karnataka-hc.bengaluru:cause_list`). */
    sourceId: text('source_id').notNull(),
    kind: text('kind').$type<CauseListWatchKind>().notNull(),
    /** The advocate name as written, or the BRN upper-cased. */
    value: text('value').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('cause_list_watch_uq').on(t.workspaceId, t.userId, t.sourceId, t.kind, t.value),
    foreignKey({
      name: 'cause_list_watch_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    check('cause_list_watch_kind_chk', sql`kind in ('name', 'brn')`),
    check('cause_list_watch_value_chk', sql`char_length(value) between 1 and 200`),
  ],
);

export const causeListPublication = pgTable(
  'cause_list_publication',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id').notNull(),
    /** The list's identity, e.g. `daily:2026-10-23`. */
    listKey: text('list_key').notNull(),
    url: text('url').notNull(),
    sha256: text('sha256').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    rowCount: integer('row_count').notNull().default(0),
    /** Set once every watching workspace was matched; a null row is retried by the next poll. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    unique('cause_list_publication_sha_uq').on(t.sourceId, t.sha256),
    index('cause_list_publication_list_idx').on(t.sourceId, t.listKey, t.fetchedAt),
  ],
);
