// The raw judgments and orders corpus (#484, D-048, D-004): one global row per judgment or order
// read from a cleared public source (Madras HC, Karnataka HC, Supreme Court). It holds the document
// as published (text layer per page, sha256, provenance) and nothing editorial: no headnotes,
// summaries, holdings or citator (D-001 amended; *EBC v. D.B. Modak*). `judgment` is a global table
// (GLOBAL_TABLES, no RLS); the app role may SELECT and INSERT, never UPDATE or DELETE. Citation
// verification (`verifyCitation` in core) resolves a normalised neutral citation to one row.
import { sql } from 'drizzle-orm';
import {
  bigint,
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
  /** Where the page text came from; absent means the PDF text layer. */
  source?: 'text' | 'ocr';
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
    /** Failed OCR attempts so far (#1030). */
    attempts: integer('attempts').notNull().default(0),
    /** The last failure code; never page content. */
    lastError: text('last_error'),
    /** Backoff: the page is not claimed before this time. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set once retries are exhausted; a parked page is kept with its error and never claimed. */
    parkedAt: timestamp('parked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('corpus_ocr_queue_page_uq').on(t.judgmentId, t.pageNo)],
);

/**
 * One row per gateway call made for corpus OCR (#1030): the platform scope's own ledger, global and
 * apart from `ai_call` (tenant). Its daily sum is the platform OCR budget. Hashes and ids only.
 */
export const corpusOcrCall = pgTable('corpus_ocr_call', {
  id: uuid('id').primaryKey().defaultRandom(),
  purpose: text('purpose').notNull(),
  task: text('task').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  region: text('region').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costPaise: integer('cost_paise').notNull().default(0),
  status: text('status').notNull(),
  errorCode: text('error_code'),
  inputSha256: text('input_sha256'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
