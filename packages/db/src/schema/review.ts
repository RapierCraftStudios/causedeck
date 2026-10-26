// The Data Ops review and correction queue (#518, D-026, D-049). `review_item` is global: one row per
// low-confidence parse, cross-source conflict or user-reported error, with its assignee, SLA and
// fix. It carries no workspace: a user report holds only the consented record key (source, CNR,
// field, the value shown and the value the user says is right), and the signal items hold none.
// `review_correction` is the tenant table a fix fans out into, one row per watching workspace,
// shown there as "corrected by CauseDeck review" (provenance `system` / `causedeck-review:<id>`).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, provenance, provenanceCheck, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization, user } from './auth.ts';
import { proceeding } from './proceedings.ts';

export const REVIEW_KINDS = ['low_confidence', 'conflict', 'user_report'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const REVIEW_STATUSES = ['open', 'in_review', 'fixed', 'dismissed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** The case-status fields a record key can name; the list grows with the fields the watches read. */
export const REVIEW_FIELDS = ['next_date', 'stage', 'bench'] as const;
export type ReviewField = (typeof REVIEW_FIELDS)[number];

export const reviewItem = pgTable(
  'review_item',
  {
    id: id(),
    kind: text('kind').$type<ReviewKind>().notNull(),
    sourceId: text('source_id').notNull(),
    /** The record under review: the case's CNR; null for a source-level signal. */
    cnr: text('cnr'),
    field: text('field').$type<ReviewField>(),
    /** The value the product showed (user_report only). */
    shownValue: text('shown_value'),
    /** The value the user says is right (user_report only). */
    reportedValue: text('reported_value'),
    /** Signal detail for a source-level item: numbers only, never fetched content. */
    detail: text('detail'),
    /** The user agreed to share the record with CauseDeck staff for correction. */
    consent: boolean('consent').notNull().default(false),
    status: text('status').$type<ReviewStatus>().notNull().default('open'),
    assigneeId: uuid('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    /** SLA: when the item must be handled by, set from its kind at creation. */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    /** The reviewer's fix. */
    correctedValue: text('corrected_value'),
    resolvedBy: uuid('resolved_by').references(() => user.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    fixtureExportedAt: timestamp('fixture_exported_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('review_item_status_due_idx').on(t.status, t.dueAt),
    index('review_item_record_idx').on(t.sourceId, t.cnr, t.field),
    // One open signal per source and kind; user reports each stand alone.
    uniqueIndex('review_item_open_signal_uq')
      .on(t.kind, t.sourceId)
      .where(sql`${t.status} in ('open', 'in_review') and ${t.kind} <> 'user_report'`),
    check('review_item_kind_chk', sql`${t.kind} in ${inList(REVIEW_KINDS)}`),
    check('review_item_status_chk', sql`${t.status} in ${inList(REVIEW_STATUSES)}`),
    check(
      'review_item_field_chk',
      sql`${t.field} is null or ${t.field} in ${inList(REVIEW_FIELDS)}`,
    ),
    check(
      'review_item_report_chk',
      sql`${t.kind} <> 'user_report' or (${t.consent} and ${t.cnr} is not null and ${t.field} is not null)`,
    ),
    check(
      'review_item_fixed_chk',
      sql`${t.status} <> 'fixed' or (${t.correctedValue} is not null and ${t.resolvedAt} is not null)`,
    ),
  ],
);

export const reviewCorrection = tenantTable(
  'review_correction',
  {
    id: id(),
    proceedingId: uuid('proceeding_id').notNull(),
    reviewItemId: uuid('review_item_id')
      .notNull()
      .references(() => reviewItem.id, { onDelete: 'cascade' }),
    field: text('field').$type<ReviewField>().notNull(),
    value: text('value').notNull(),
    ...provenance(),
    ...timestamps(),
  },
  (t) => [
    unique('review_correction_workspace_proceeding_item_uq').on(
      t.workspaceId,
      t.proceedingId,
      t.reviewItemId,
    ),
    foreignKey({
      name: 'review_correction_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'review_correction_proceeding_fk',
      columns: [t.workspaceId, t.proceedingId],
      foreignColumns: [proceeding.workspaceId, proceeding.id],
    }).onDelete('cascade'),
    check('review_correction_field_chk', sql`${t.field} in ${inList(REVIEW_FIELDS)}`),
    provenanceCheck('review_correction'),
  ],
);
