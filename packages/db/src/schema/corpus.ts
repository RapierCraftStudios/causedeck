// The raw judgments and orders corpus (#484, D-048, D-004): one global row per judgment or order
// read from a cleared public source (Madras HC, Karnataka HC, Supreme Court). It holds the document
// as published (text layer per page, sha256, provenance) and nothing editorial: no headnotes,
// summaries, holdings or citator (D-001 amended; *EBC v. D.B. Modak*). `judgment` is a global table
// (GLOBAL_TABLES, no RLS); the app role may SELECT and INSERT, never UPDATE or DELETE. Citation
// verification (`verifyCitation` in core) resolves a normalised neutral citation to one row.
import { sql } from 'drizzle-orm';
import {
  date,
  index,
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
