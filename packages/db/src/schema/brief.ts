// Brief state (#60): `brief_state` is the lawyer-authored part of a listing's brief (who marked it
// prepared and when, the carry-list edits, a private note). The brief itself is a derived view and is
// never stored. One row per listing; a tenant table under FORCE RLS.
import { sql } from 'drizzle-orm';
import { check, foreignKey, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization, user } from './auth.ts';
import { listing } from './docket.ts';

/** One stored carry edit: a manual item, a tick, or the removal of a derived item. */
export interface BriefCarryEntry {
  key: string;
  manual: boolean;
  label: string | null;
  ticked: boolean;
  removed: boolean;
}

export const briefState = tenantTable(
  'brief_state',
  {
    id: id(),
    listingId: uuid('listing_id').notNull(),
    preparedBy: uuid('prepared_by').references(() => user.id, { onDelete: 'set null' }),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    carry: jsonb('carry')
      .$type<BriefCarryEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    note: text('note'),
    updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    unique('brief_state_workspace_listing_uq').on(t.workspaceId, t.listingId),
    foreignKey({
      name: 'brief_state_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'brief_state_listing_fk',
      columns: [t.workspaceId, t.listingId],
      foreignColumns: [listing.workspaceId, listing.id],
    }).onDelete('cascade'),
    check('brief_state_carry_chk', sql`jsonb_typeof(${t.carry}) = 'array'`),
  ],
);
