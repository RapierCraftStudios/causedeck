// A0 corrections (#558, deferred from #56 R10): what a person changed in the confirmation grid,
// linked to the document the row was read from. Backs the `CorrectionStore` port in
// `@causedeck/intelligence`. A tenant table under FORCE RLS via `tenantTable()`. The text of a
// correction is customer content: it is never sent to a model and never used for training.
// `eval_consent` is the per-item consent to share the correction in an eval set (default false); it
// only counts while `workspace_settings.allow_eval_reuse` is also true.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { organization } from './auth.ts';
import { document } from './documents.ts';

export const CORRECTION_COLUMNS = [
  'caseNumber',
  'parties',
  'courtHall',
  'stageText',
  'date',
] as const;
export type CorrectionColumn = (typeof CORRECTION_COLUMNS)[number];

export const correction = tenantTable(
  'correction',
  {
    id: id(),
    documentId: uuid('document_id').notNull(),
    forumCode: text('forum_code').notNull(),
    /** The row's identity key in the confirmation grid. */
    rowKey: text('row_key').notNull(),
    columnName: text('column_name').$type<CorrectionColumn>().notNull(),
    /** What the document gave; null when the cell was empty. */
    before: text('before'),
    after: text('after').notNull(),
    page: integer('page').notNull(),
    quote: text('quote').notNull(),
    /** Per-item consent to eval reuse; effective only while the workspace allows it. */
    evalConsent: boolean('eval_consent').notNull().default(false),
    /** The member who saved it; a bare id (no FK), like the outward share log. */
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('correction_workspace_id_id_uq').on(t.workspaceId, t.id),
    foreignKey({
      name: 'correction_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'correction_document_fk',
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete('cascade'),
    check('correction_page_chk', sql`page >= 1`),
    check('correction_after_chk', sql`btrim(after) <> ''`),
    check(
      'correction_column_chk',
      sql`column_name in ('caseNumber', 'parties', 'courtHall', 'stageText', 'date')`,
    ),
  ],
);
