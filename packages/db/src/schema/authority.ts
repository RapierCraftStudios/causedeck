// Citation checker rows (#77, DR-2). One `authority` row per citation found in one immutable
// `draft_version`, unique on `(draft_version_id, block_id, span)` so a re-check updates in place.
// A new version has no rows until it is checked, which is how a stale status is never current.
// Only the citation string, status, canonical URL and a short title are stored (`resolution` holds
// `{reason, title, similarity, source}`): there is no column for judgment text. `ack_by`/`ack_at`
// record the member who acknowledged a `not_found` citation before an export.
import { sql } from 'drizzle-orm';
import { check, foreignKey, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { draftVersion } from './drafting.ts';

export const AUTHORITY_STATUSES = ['verified', 'not_found', 'unknown'] as const;
export const AUTHORITY_KINDS = ['neutral', 'reporter', 'case_name'] as const;

export const authority = tenantTable(
  'authority',
  {
    id: id(),
    draftVersionId: uuid('draft_version_id').notNull(),
    blockId: text('block_id').notNull(),
    /** `[start, end)` in the block's text. */
    span: jsonb('span').$type<[number, number]>().notNull(),
    rawText: text('raw_text').notNull(),
    normalized: text('normalized').notNull(),
    kind: text('kind').notNull(),
    resolution: jsonb('resolution')
      .$type<{ reason?: string; title?: string; similarity?: number; source?: string }>()
      .notNull()
      .default({}),
    status: text('status').notNull(),
    sourceUrl: text('source_url'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    ackBy: uuid('ack_by').references(() => user.id, { onDelete: 'set null' }),
    ackAt: timestamp('ack_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'authority_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'authority_version_fk',
      columns: [t.workspaceId, t.draftVersionId],
      foreignColumns: [draftVersion.workspaceId, draftVersion.id],
    }).onDelete('cascade'),
    unique('authority_version_block_span_uq').on(t.draftVersionId, t.blockId, t.span),
    check('authority_status_chk', sql`status in ${inList(AUTHORITY_STATUSES)}`),
    check('authority_kind_chk', sql`kind in ${inList(AUTHORITY_KINDS)}`),
  ],
);
