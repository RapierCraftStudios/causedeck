// Documents of the matter graph (#345, part 2 of #32; #32 data contract, ADR 0013): `document` (a
// version chain through `supersedes_document_id`), its `document_page`s and the `anchor`s that facts
// cite. Tenant tables under FORCE RLS via `tenantTable()`, with composite `(workspace_id, *_id)` FKs.
// `document` and `anchor` carry a unique `(workspace_id, id)` for the FKs of later parts (#346-#348:
// listing source documents, orders, provenance `anchor_id`).
//
// `document.matter_id` is NO ACTION: a matter with documents cannot be deleted on its own (the erase
// purges documents first). `supersedes_document_id` is `ON DELETE SET NULL (supersedes_document_id)`
// in migration 0038, like the nullable matter FKs (see matter-graph.ts). `source_capture_id` is
// `ON DELETE SET NULL (source_capture_id)` in migration 0053 (the capture table, #43).
import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../columns.ts';
import { tenantTable } from '../schema-helpers/tenant-table.ts';

import { inList, organization } from './auth.ts';
import { capture } from './capture.ts';
import { documentKind, documentTextStatus } from './enums.ts';
import { matter } from './matter-graph.ts';

export const ANCHOR_KINDS = [
  'document',
  'transcript',
  'list_row',
  'calendar_event',
  'email',
  'image_region',
] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/** The longest quote an anchor may store (characters). */
export const ANCHOR_QUOTE_MAX = 2000;

/** A rectangle on the page, in page units. */
export interface AnchorBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A span of a recording's transcript, in milliseconds. */
export interface AnchorTranscriptSpan {
  startMs: number;
  endMs: number;
  speaker?: string;
}

/** Postgres `tsvector`; only ever a generated column, so it is read, never written. */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const document = tenantTable(
  'document',
  {
    id: id(),
    kind: documentKind('kind').notNull(),
    language: text('language'),
    /** The earlier version this one replaces. */
    supersedesDocumentId: uuid('supersedes_document_id'),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    textStatus: documentTextStatus('text_status').notNull().default('pending'),
    sourceCaptureId: uuid('source_capture_id'),
    matterId: uuid('matter_id'),
    /** The document pipeline version that produced this row (#45); null for a manual document. */
    pipelineVersion: text('pipeline_version'),
    /** 0-1 confidence of `kind` (deterministic rule score or the model's); null before the pipeline ran. */
    classificationConfidence: numeric('classification_confidence', { precision: 4, scale: 3 }),
    /** Page numbers whose OCR confidence was under the floor. */
    lowConfidencePages: jsonb('low_confidence_pages')
      .$type<number[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Why text extraction did not run (`ai_blocked`, `sensitive_matter`); with `text_status = 'skipped'`. */
    textSkippedReason: text('text_skipped_reason'),
    /** 64-bit simhash of the normalised text, 16 hex characters; the near-duplicate lookup key. */
    textSimhash: text('text_simhash'),
    ...timestamps(),
  },
  (t) => [
    unique('document_workspace_id_id_uq').on(t.workspaceId, t.id),
    // One document per capture and pipeline version: the pipeline's idempotency guard (#45).
    unique('document_capture_pipeline_uq').on(t.workspaceId, t.sourceCaptureId, t.pipelineVersion),
    index('document_workspace_matter_idx').on(t.workspaceId, t.matterId),
    foreignKey({
      name: 'document_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'document_matter_fk',
      columns: [t.workspaceId, t.matterId],
      foreignColumns: [matter.workspaceId, matter.id],
    }),
    foreignKey({
      name: 'document_source_capture_fk',
      columns: [t.workspaceId, t.sourceCaptureId],
      foreignColumns: [capture.workspaceId, capture.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'document_supersedes_fk',
      columns: [t.workspaceId, t.supersedesDocumentId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('set null'),
    check('document_sha256_chk', sql`sha256 ~ '^[0-9a-f]{64}$'`),
    check(
      'document_classification_confidence_chk',
      sql`classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1)`,
    ),
    check(
      'document_text_simhash_chk',
      sql`text_simhash is null or text_simhash ~ '^[0-9a-f]{16}$'`,
    ),
    check(
      'document_not_superseding_self_chk',
      sql`supersedes_document_id is null or supersedes_document_id <> id`,
    ),
  ],
);

export const documentPage = tenantTable(
  'document_page',
  {
    id: id(),
    documentId: uuid('document_id').notNull(),
    pageNo: integer('page_no').notNull(),
    text: text('text'),
    /** Where the text came from, e.g. the PDF text layer or OCR. */
    textSource: text('text_source'),
    ocrConfidence: numeric('ocr_confidence', { precision: 4, scale: 3 }),
    lang: text('lang'),
    /** `blob.key` of the 150 DPI WebP thumbnail (#45). */
    imageKey: text('image_key'),
    /** `blob.key` of the 1024 px WebP preview. */
    previewKey: text('preview_key'),
    /** Rendered thumbnail size in pixels. */
    width: integer('width'),
    height: integer('height'),
    /** `simple`-config full-text vector of `text`: no stemming, so Tamil and Kannada match whole words. */
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(text, ''))`,
    ),
    ...timestamps(),
  },
  (t) => [
    index('document_page_search_tsv_idx').using('gin', t.searchTsv),
    unique('document_page_document_page_uq').on(t.workspaceId, t.documentId, t.pageNo),
    foreignKey({
      name: 'document_page_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'document_page_document_fk',
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete('cascade'),
    check('document_page_page_no_chk', sql`page_no >= 1`),
    check(
      'document_page_ocr_confidence_chk',
      sql`ocr_confidence is null or (ocr_confidence >= 0 and ocr_confidence <= 1)`,
    ),
  ],
);

export const anchor = tenantTable(
  'anchor',
  {
    id: id(),
    documentId: uuid('document_id').notNull(),
    pageNo: integer('page_no').notNull(),
    quote: text('quote').notNull(),
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    bbox: jsonb('bbox').$type<AnchorBbox>(),
    kind: text('kind').$type<AnchorKind>().notNull(),
    transcriptSpan: jsonb('transcript_span').$type<AnchorTranscriptSpan>(),
    ...timestamps(),
  },
  (t) => [
    // The target of the composite provenance `(workspace_id, anchor_id)` FKs (#346-#348).
    unique('anchor_workspace_id_id_uq').on(t.workspaceId, t.id),
    index('anchor_workspace_document_idx').on(t.workspaceId, t.documentId),
    foreignKey({
      name: 'anchor_workspace_id_fk',
      columns: [t.workspaceId],
      foreignColumns: [organization.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'anchor_document_fk',
      columns: [t.workspaceId, t.documentId],
      foreignColumns: [document.workspaceId, document.id],
    }).onDelete('cascade'),
    check('anchor_kind_chk', sql`kind in ${inList(ANCHOR_KINDS)}`),
    check(
      'anchor_quote_length_chk',
      sql`char_length(quote) <= ${sql.raw(String(ANCHOR_QUOTE_MAX))}`,
    ),
    check('anchor_page_no_chk', sql`page_no >= 1`),
    check(
      'anchor_char_range_chk',
      sql`(char_start is null or char_start >= 0) and (char_end is null or char_start is null or char_end >= char_start)`,
    ),
  ],
);
