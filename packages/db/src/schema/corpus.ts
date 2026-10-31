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
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { embedding, halfvecEmbedding } from '../vector.ts';

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

/** How a judgment disposed of the matter (#894); `unknown` whenever no decision sentence says so. */
export const JUDGMENT_OUTCOMES = [
  'allowed',
  'partly_allowed',
  'dismissed',
  'remanded',
  'disposed',
  'unknown',
] as const;
export type JudgmentOutcome = (typeof JUDGMENT_OUTCOMES)[number];

/** Where an outcome was read: a page of the redacted text and the sentence on it. */
export interface JudgmentOutcomeAnchor {
  page: number;
  quote: string;
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
    /** The `SEGMENT_VERSION` of the segments built from `redacted_text` at `redaction_version`; 0 means not yet segmented (#893). */
    segmentVersion: integer('segment_version').notNull().default(0),
    /** The `redaction_version` the current segments were built from. */
    segmentedRedactionVersion: integer('segmented_redaction_version').notNull().default(0),
    /** `supreme_court`, `high_court` or `other`; null until enriched (#894). */
    courtLevel: text('court_level'),
    /** How the matter ended, read from the decision segment; `unknown` unless `outcome_anchor` backs it (#894). */
    outcome: text('outcome').$type<JudgmentOutcome>().notNull().default('unknown'),
    /** The page and sentence the outcome was read from; null exactly when the outcome is `unknown`. */
    outcomeAnchor: jsonb('outcome_anchor').$type<JudgmentOutcomeAnchor>(),
    /** The `ENRICH_VERSION` of the facet rows built for this judgment; 0 means not yet enriched (#894). */
    enrichVersion: integer('enrich_version').notNull().default(0),
    /** The `redaction_version` the facets were built from. */
    enrichedRedactionVersion: integer('enriched_redaction_version').notNull().default(0),
    /** Retrieval embedding; null until an ADR picks the model and a job fills it. */
    embedding: embedding(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('judgment_sha256_uq').on(t.sha256),
    index('judgment_neutral_citation_idx').on(t.neutralCitation),
    index('judgment_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    check(
      'judgment_outcome_check',
      sql`${t.outcome} in ('allowed','partly_allowed','dismissed','remanded','disposed','unknown')`,
    ),
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

/** The rhetorical role of a segment (ADR 0051 §Segments). */
export const JUDGMENT_SEGMENT_ROLES = [
  'header',
  'facts',
  'issues',
  'arguments',
  'reasoning',
  'decision',
  'other',
] as const;
export type JudgmentSegmentRole = (typeof JUDGMENT_SEGMENT_ROLES)[number];

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * A passage of the redacted text, the unit of retrieval (#893, ADR 0051). Global table, no RLS: the
 * app role may SELECT, and the segment job its writes. The migration range-partitions it by
 * `judgment_year` in decades (drizzle does not model partitions), so the primary key carries the year,
 * and sets lz4 compression on `text`.
 */
export const judgmentSegment = pgTable(
  'judgment_segment',
  {
    id: uuid('id').defaultRandom().notNull(),
    judgmentId: uuid('judgment_id')
      .notNull()
      .references(() => judgment.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    role: text('role').$type<JudgmentSegmentRole>().notNull(),
    pageFrom: integer('page_from').notNull(),
    pageTo: integer('page_to').notNull(),
    /** The redacted text (D-053); never derived from `judgment.page_text`. */
    text: text('text').notNull(),
    /** `judgment.court`, `court_level` and year, denormalised for filtering and partitioning. */
    court: text('court').notNull(),
    courtLevel: text('court_level').notNull(),
    judgmentYear: integer('judgment_year').notNull(),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', "text"), 'A') || to_tsvector('simple', "text")`,
    ),
    /** Filled by the embedding job; null until then. */
    embedding: halfvecEmbedding(),
    /** The model version that produced `embedding` (#895); a different current version re-embeds. */
    embeddingModel: text('embedding_model'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.judgmentYear] }),
    uniqueIndex('judgment_segment_ordinal_uq').on(t.judgmentId, t.ordinal, t.judgmentYear),
    index('judgment_segment_search_tsv_idx').using('gin', t.searchTsv),
    check(
      'judgment_segment_role_check',
      sql`${t.role} in ('header','facts','issues','arguments','reasoning','decision','other')`,
    ),
    check('judgment_segment_pages_check', sql`${t.pageFrom} >= 1 and ${t.pageTo} >= ${t.pageFrom}`),
  ],
);

/**
 * A statute section a judgment cites (#894, ADR 0051 §Enrichment), with the page it is cited on.
 * `statute` and `section` are the `normaliseStatute` and `normaliseSection` keys. Global table, no
 * RLS. `ruleset_version` names the rules that produced the row; a re-run replaces only the rows of
 * its own version.
 */
export const judgmentStatuteRef = pgTable(
  'judgment_statute_ref',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    judgmentId: uuid('judgment_id')
      .notNull()
      .references(() => judgment.id, { onDelete: 'cascade' }),
    statute: text('statute').notNull(),
    section: text('section').notNull(),
    page: integer('page').notNull(),
    rulesetVersion: text('ruleset_version').notNull(),
  },
  (t) => [
    uniqueIndex('judgment_statute_ref_uq').on(t.judgmentId, t.rulesetVersion, t.statute, t.section),
    index('judgment_statute_ref_facet_idx').on(t.statute, t.section),
    check('judgment_statute_ref_page_check', sql`${t.page} >= 1`),
  ],
);

/**
 * A case a judgment cites (#894). Only the citation string is stored, never reporter text.
 * `cited_judgment_id` is set when the normalised citation is a neutral citation of a corpus row.
 */
export const judgmentCitationRef = pgTable(
  'judgment_citation_ref',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    judgmentId: uuid('judgment_id')
      .notNull()
      .references(() => judgment.id, { onDelete: 'cascade' }),
    rawCitation: text('raw_citation').notNull(),
    normalisedCitation: text('normalised_citation').notNull(),
    citedJudgmentId: uuid('cited_judgment_id').references(() => judgment.id, {
      onDelete: 'set null',
    }),
    page: integer('page').notNull(),
    rulesetVersion: text('ruleset_version').notNull(),
  },
  (t) => [
    uniqueIndex('judgment_citation_ref_uq').on(
      t.judgmentId,
      t.rulesetVersion,
      t.normalisedCitation,
    ),
    index('judgment_citation_ref_cited_idx').on(t.citedJudgmentId),
    check('judgment_citation_ref_page_check', sql`${t.page} >= 1`),
  ],
);

/** A subject area the gateway assigned to a judgment (#894), with its confidence and model version. */
export const judgmentTag = pgTable(
  'judgment_tag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    judgmentId: uuid('judgment_id')
      .notNull()
      .references(() => judgment.id, { onDelete: 'cascade' }),
    subjectArea: text('subject_area').notNull(),
    confidence: real('confidence').notNull(),
    modelVersion: text('model_version').notNull(),
  },
  (t) => [
    uniqueIndex('judgment_tag_uq').on(t.judgmentId, t.modelVersion, t.subjectArea),
    index('judgment_tag_area_idx').on(t.subjectArea),
    check('judgment_tag_confidence_check', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
  ],
);
