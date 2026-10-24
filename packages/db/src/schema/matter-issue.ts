// Matter issue tags and judgment alerts (#497, D-048, D-004): `matter_issue_tag` is a statute (and
// section) a matter turns on, proposed from its pleadings and orders and used for alerts only once
// the lawyer confirms it; `judgment_alert` records that a corpus judgment cites a confirmed tag of a
// matter (one row per matter and judgment), with the page it was found on. Both are tenant tables
// under FORCE RLS via `tenantTable()`. The alert points at the global `judgment` row and holds no
// copy of its text, and neither table carries editorial content (D-001 amended).
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { judgment } from './corpus.ts';
import { matter } from './matter-graph.ts';

export const ISSUE_TAG_STATUSES = ['proposed', 'confirmed', 'dismissed'] as const;
export type IssueTagStatus = (typeof ISSUE_TAG_STATUSES)[number];

export const ISSUE_TAG_SOURCES = ['ai', 'manual'] as const;
export type IssueTagSource = (typeof ISSUE_TAG_SOURCES)[number];

export const matterIssueTag = tenantTable(
  'matter_issue_tag',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    /** Normalised statute key (`normaliseStatute`), e.g. `arbitration and conciliation act`. */
    statute: text('statute').notNull(),
    /** Normalised section (`34`, `11(6)`); empty when the tag names a statute only. */
    section: text('section').notNull().default(''),
    /** The legal issue in the lawyer's words, when the proposal or the lawyer gave one. */
    issue: text('issue'),
    status: text('status').$type<IssueTagStatus>().notNull().default('proposed'),
    source: text('source').$type<IssueTagSource>().notNull(),
    /** 0-1 model confidence of an AI proposal; null for a manual tag. */
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    ...timestamps(),
  },
  (t) => [
    unique('matter_issue_tag_workspace_id_id_uq').on(t.workspaceId, t.id),
    unique('matter_issue_tag_matter_statute_section_uq').on(
      t.workspaceId,
      t.matterId,
      t.statute,
      t.section,
    ),
    foreignKey({
      name: 'matter_issue_tag_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'matter_issue_tag_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    check('matter_issue_tag_status_chk', sql`status in ${inList(ISSUE_TAG_STATUSES)}`),
    check('matter_issue_tag_source_chk', sql`source in ${inList(ISSUE_TAG_SOURCES)}`),
    check('matter_issue_tag_statute_chk', sql`statute <> ''`),
    check(
      'matter_issue_tag_confidence_chk',
      sql`confidence is null or (confidence >= 0 and confidence <= 1)`,
    ),
  ],
);

export const judgmentAlert = tenantTable(
  'judgment_alert',
  {
    id: id(),
    matterId: uuid('matter_id').notNull(),
    tagId: uuid('tag_id').notNull(),
    /** The corpus record; the corpus is append-only, so the row is never deleted from under an alert. */
    judgmentId: uuid('judgment_id')
      .notNull()
      .references(() => judgment.id, { onDelete: 'restrict' }),
    /** The page of the judgment the cited section was found on (1-based). */
    pageNo: integer('page_no').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the advocates were notified; null while the notification is pending. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [
    unique('judgment_alert_matter_judgment_uq').on(t.workspaceId, t.matterId, t.judgmentId),
    foreignKey({
      name: 'judgment_alert_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'judgment_alert_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'judgment_alert_tag_fk',
      columns: [t.workspaceId, t.tagId],
      foreignColumns: [matterIssueTag.workspaceId, matterIssueTag.id],
    }).onDelete('cascade'),
    check('judgment_alert_page_chk', sql`page_no >= 1`),
  ],
);
