// Anchored order extraction (#46; PRD DI-3; docs/product/09 §4.4): one row per extraction of a
// document under a pipeline version. `result` is the validated `OrderExtraction` (every kept field
// carries an anchor), `rejected` the fields the validator removed with their reason, so nothing is
// dropped silently. Re-extracting supersedes the current row (`status = 'superseded'`) and never
// deletes it; at most one row per (document, pipeline version) is current. Tenant table under
// FORCE RLS via `tenantTable()`, composite `(workspace_id, document_id)` FK.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { document } from './documents.ts';

export const EXTRACTION_STATUSES = ['current', 'superseded'] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const extraction = tenantTable(
  'extraction',
  {
    id: id(),
    documentId: uuid('document_id').notNull(),
    pipelineVersion: text('pipeline_version').notNull(),
    status: text('status').$type<ExtractionStatus>().notNull().default('current'),
    /** The validated extraction (`OrderExtraction` in `@causedeck/intelligence`). */
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    /** Fields the validator removed: `{ field, reason, detail? }[]`. */
    rejected: jsonb('rejected')
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ambiguous: boolean('ambiguous').notNull().default(false),
    suspicious: boolean('suspicious').notNull().default(false),
    /** True when the LLM step was skipped (`ai_blocked` capture or sensitive matter). */
    deterministicOnly: boolean('deterministic_only').notNull().default(false),
    /** The reason the capture was routed to `needs_you`, if it was. */
    needsYouReason: text('needs_you_reason'),
    /** The `ai_call` behind the model step; null when no model ran. */
    aiCallId: uuid('ai_call_id'),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index('extraction_workspace_document_idx').on(t.workspaceId, t.documentId),
    uniqueIndex('extraction_current_uq')
      .on(t.workspaceId, t.documentId, t.pipelineVersion)
      .where(sql`status = 'current'`),
    foreignKey({
      name: 'extraction_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'extraction_document_fk',
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete('cascade'),
    check('extraction_status_chk', sql`status in ${inList(EXTRACTION_STATUSES)}`),
    check('extraction_superseded_chk', sql`(status = 'superseded') = (superseded_at is not null)`),
    check('extraction_rejected_chk', sql`jsonb_typeof(rejected) = 'array'`),
  ],
);
