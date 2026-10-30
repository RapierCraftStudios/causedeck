// The raw judgments and orders corpus (#484, D-048, D-004): one global row per judgment or order
// read from a cleared public source (Madras HC, Karnataka HC, Supreme Court). It holds the document
// as published (text layer per page, sha256, provenance) and nothing editorial: no headnotes,
// summaries, holdings or citator (D-001 amended; *EBC v. D.B. Modak*). `judgment` is a global table
// (GLOBAL_TABLES, no RLS); the app role may SELECT and INSERT, never DELETE, and UPDATE only the derived redaction columns (#892). Citation
// verification (`verifyCitation` in core) resolves a normalised neutral citation to one row.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { embedding } from '../vector.ts';

/** One page of the stored text layer; `pageNo` is 1-based and is the anchor a citation points at. */
export interface JudgmentPageText {
  pageNo: number;
  text: string;
}

/** Where and when the judgment was read (the `FetchProvenance` of `@causedeck/fetch`). */
export interface JudgmentProvenance {
  url: string;
  fetchedAt: string;
  sha256: string;
  sourceId: string;
  sourceVersion: string;
  tierUsed: string;
  costDollars: number;
  /** The licence the source publishes under (open datasets, #890), e.g. `CC-BY-4.0`. */
  licence?: string;
}

export const judgment = pgTable(
  'judgment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The registry source this was read from (`source.id`); not a foreign key, the corpus outlives sources. */
    sourceId: text('source_id').notNull(),
    /** Court code as printed in the neutral citation: `MHC`, `KHC`, `KHC-D`, `INSC`. */
    court: text('court').notNull(),
    /** Canonical neutral citation (`normaliseNeutralCitation`), e.g. `2026:MHC:1234`; null when none is printed. */
    neutralCitation: text('neutral_citation'),
    caseNumbers: text('case_numbers')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    bench: text('bench')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    judgmentDate: date('judgment_date', { mode: 'string' }),
    /** The stored object key of the original PDF, once a blob store holds it. */
    blobKey: text('blob_key'),
    /** sha256 hex of the fetched body: the dedupe key. */
    sha256: text('sha256').notNull(),
    provenance: jsonb('provenance').$type<JudgmentProvenance>().notNull(),
    /** The text layer per page; anchors are page numbers into this array. */
    pageText: jsonb('page_text').$type<JudgmentPageText[]>().notNull(),
    /** The anonymised text per page (#892, ADR 0051); derived from `page_text`, null until redacted. Served instead of `page_text`. */
    redactedText: jsonb('redacted_text').$type<JudgmentPageText[]>(),
    /** The case title as published, or its masked form when `title_masked`. */
    caseTitle: text('case_title'),
    titleMasked: boolean('title_masked').notNull().default(false),
    /** The `REDACTION_VERSION` that produced `redacted_text`; 0 means not yet redacted. */
    redactionVersion: integer('redaction_version').notNull().default(0),
    /** POCSO, sexual offence, juvenile, matrimonial, in camera or acquittal; null when none. */
    sensitiveCategory: text('sensitive_category'),
    /** Why the title is masked: `auto:<category>` or `mask_request:<id>`. */
    maskReason: text('mask_reason'),
    /** Retrieval embedding; null until an ADR picks the model and a job fills it. */
    embedding: embedding(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('judgment_sha256_uq').on(t.sha256),
    index('judgment_neutral_citation_idx').on(t.neutralCitation),
    index('judgment_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/** The open-data datasets `corpus.bulk_import` reads (#890): `sc` Supreme Court, `hc` High Courts. */
export const CORPUS_BULK_DATASETS = ['sc', 'hc'] as const;
export type CorpusBulkDataset = (typeof CORPUS_BULK_DATASETS)[number];

/** Where a bulk archive stands: `pending` until a run reaches it, `complete` once every entry was read. */
export const CORPUS_IMPORT_STATUSES = ['pending', 'running', 'complete', 'failed'] as const;
export type CorpusImportStatus = (typeof CORPUS_IMPORT_STATUSES)[number];

/**
 * The resume point and running counts of one bulk archive (#890, D-053). `position` is the number
 * of archive entries already handled, so an interrupted run continues after them. Global table:
 * counts and object keys only, no document content.
 */
export const corpusImportCursor = pgTable(
  'corpus_import_cursor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The registry source the archive belongs to (`aws-open-data-sc`, `aws-open-data-hc`). */
    sourceId: text('source_id').notNull(),
    dataset: text('dataset').$type<CorpusBulkDataset>().notNull(),
    /** The court path segment for High Court archives; null for the Supreme Court. */
    court: text('court'),
    year: integer('year').notNull(),
    /** The archive's object key in the dataset bucket. */
    archiveKey: text('archive_key').notNull(),
    position: integer('position').notNull().default(0),
    status: text('status').$type<CorpusImportStatus>().notNull().default('pending'),
    rowsAdded: integer('rows_added').notNull().default(0),
    duplicatesSkipped: integer('duplicates_skipped').notNull().default(0),
    failures: integer('failures').notNull().default(0),
    /** Bytes of PDFs stored for this archive. */
    bytesStored: bigint('bytes_stored', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('corpus_import_cursor_archive_uq').on(t.sourceId, t.archiveKey),
    index('corpus_import_cursor_dataset_idx').on(t.dataset, t.year),
  ],
);

/** A judgment page whose text layer is missing or too thin and waits for OCR (#890). */
export const corpusOcrQueue = pgTable(
  'corpus_ocr_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    judgmentId: uuid('judgment_id')
      .notNull()
      .references(() => judgment.id),
    pageNo: integer('page_no').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('corpus_ocr_queue_page_uq').on(t.judgmentId, t.pageNo)],
);

/** Where a mask request stands (#892): `pending` until staff apply it, `applied` once done, `rejected` when declined. */
export const CORPUS_MASK_REQUEST_STATUSES = ['pending', 'applied', 'rejected'] as const;
export type CorpusMaskRequestStatus = (typeof CORPUS_MASK_REQUEST_STATUSES)[number];

/**
 * A court order or request to mask a judgment (#892, D-053): who asked, what to mask, on what legal
 * basis, and when staff handled it. Global table, no workspace data.
 */
export const corpusMaskRequest = pgTable(
  'corpus_mask_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The judgment to mask; not a foreign key, so a request survives a corpus rebuild. */
    judgmentId: uuid('judgment_id').notNull(),
    /** Who asked: the court, a party, a lawyer or a data subject. */
    requestedBy: text('requested_by').notNull(),
    /** What to mask: the title, named persons, or the whole text. */
    requestedAction: text('requested_action').notNull(),
    /** Names to remove from the text beyond what the rules found. */
    names: text('names')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The order or rule the request rests on. */
    legalBasis: text('legal_basis').notNull(),
    status: text('status').$type<CorpusMaskRequestStatus>().notNull().default('pending'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    handledBy: uuid('handled_by'),
  },
  (t) => [
    index('corpus_mask_request_judgment_idx').on(t.judgmentId),
    index('corpus_mask_request_status_idx').on(t.status),
  ],
);
