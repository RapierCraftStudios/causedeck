// Judgment ingestion (#484, D-048): fetch one judgment PDF through the governed fetch layer, read its
// text layer per page, extract the header and store one global `judgment` row. The fetcher is a
// structural port (`@causedeck/fetch`'s `Fetcher` satisfies it), so every external read stays behind
// the registry, tier caps and kill switch, and this package imports no fetch code. Re-ingesting the
// same bytes is a no-op: the sha256 of the body is the dedupe key.
import { schema, type Queryable } from '@causedeck/db';
import { eq } from 'drizzle-orm';

import { readPdfText, type PdfPageText } from '../text/pdf-text.ts';
import { coverage, DEFAULT_MIN_PAGE_CHARS } from '../text/quality.ts';

import { courtOfCitation, extractJudgmentHeader } from './header.ts';

const { judgment, corpusOcrQueue } = schema;

/** The part of `FetchResult` ingestion reads. */
export interface CorpusFetchResult {
  body: string;
  contentType: string;
  provenance: schema.JudgmentProvenance;
}

/** Structurally the `Fetcher` of `@causedeck/fetch`. */
export interface CorpusFetcher {
  fetchSource(sourceId: string, url: string): Promise<CorpusFetchResult>;
}

/** Where original PDFs are kept, keyed by sha256 (ADR 0051); absent means `blob_key` stays null. */
export interface CorpusBlobStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/** The object key of a judgment's original PDF. */
export const corpusBlobKey = (sha256: string): string => `corpus/${sha256}.pdf`;

export interface StoreDeps {
  db: Queryable;
  /** Defaults to `readPdfText`; tests pass a fake. */
  readPdf?: (data: Uint8Array) => Promise<PdfPageText[]>;
  blobs?: CorpusBlobStore | null | undefined;
}

export interface IngestDeps extends StoreDeps {
  fetcher: CorpusFetcher;
}

/** Header fields known from a dataset's own metadata; they win over what the PDF text yields. */
export interface JudgmentMetadata {
  court?: string | null;
  neutralCitation?: string | null;
  caseNumbers?: string[];
  bench?: string[];
  judgmentDate?: string | null;
}

export type IngestOutcome =
  | { status: 'inserted' | 'duplicate'; judgmentId: string; sha256: string }
  | { status: 'unreadable'; sha256: string };

/** What `storeJudgment` reports: the outcome and how many pages the text layer had. */
export type StoredOutcome = IngestOutcome & { pages: number };

/**
 * The bytes of a fetched body. The provider returns text: a body that starts with `%PDF` is taken
 * as latin1 bytes, anything else for a PDF content type as base64.
 */
export function bodyBytes(body: string, contentType: string): Uint8Array {
  if (body.startsWith('%PDF')) return Buffer.from(body, 'latin1');
  if (/pdf/i.test(contentType)) return Buffer.from(body, 'base64');
  return Buffer.from(body, 'utf8');
}

/** Fetch, read and store one judgment. Never throws for an unreadable PDF: it reports `unreadable`. */
export async function ingestJudgment(
  deps: IngestDeps,
  input: { sourceId: string; url: string },
): Promise<IngestOutcome> {
  const fetched = await deps.fetcher.fetchSource(input.sourceId, input.url);
  const { pages: _pages, ...outcome } = await storeJudgment(deps, {
    sourceId: input.sourceId,
    bytes: bodyBytes(fetched.body, fetched.contentType),
    provenance: fetched.provenance,
  });
  return outcome;
}

/**
 * Store the bytes of one judgment: dedupe on sha256, read the text layer, upload the PDF when a blob
 * store is given, insert the row and queue every page without a usable text layer for OCR. Shared by
 * `ingestJudgment` (corpus.poll) and the bulk importer.
 */
export async function storeJudgment(
  deps: StoreDeps,
  input: {
    sourceId: string;
    bytes: Uint8Array;
    provenance: schema.JudgmentProvenance;
    metadata?: JudgmentMetadata;
  },
): Promise<StoredOutcome> {
  const { sha256 } = input.provenance;

  const [existing] = await deps.db
    .select({ id: judgment.id })
    .from(judgment)
    .where(eq(judgment.sha256, sha256))
    .limit(1);
  if (existing !== undefined) return { status: 'duplicate', judgmentId: existing.id, sha256, pages: 0 };

  let pages: PdfPageText[];
  try {
    pages = await (deps.readPdf ?? readPdfText)(input.bytes);
  } catch {
    return { status: 'unreadable', sha256, pages: 0 };
  }
  const header = extractJudgmentHeader(pages.map((p) => p.text));
  const meta = input.metadata ?? {};
  const neutralCitation = header.neutralCitation ?? meta.neutralCitation ?? null;
  const caseNumbers = header.caseNumbers.length > 0 ? header.caseNumbers : (meta.caseNumbers ?? []);
  const bench = header.bench.length > 0 ? header.bench : (meta.bench ?? []);

  let blobKey: string | null = null;
  if (deps.blobs !== undefined && deps.blobs !== null) {
    blobKey = corpusBlobKey(sha256);
    await deps.blobs.put(blobKey, input.bytes, 'application/pdf');
  }

  const [row] = await deps.db
    .insert(judgment)
    .values({
      sourceId: input.sourceId,
      court:
        header.court ??
        (neutralCitation === null ? null : courtOfCitation(neutralCitation)) ??
        meta.court ??
        input.sourceId,
      neutralCitation,
      caseNumbers,
      bench,
      judgmentDate: header.judgmentDate ?? meta.judgmentDate ?? null,
      blobKey,
      sha256,
      provenance: input.provenance,
      pageText: pages,
    })
    .onConflictDoNothing({ target: judgment.sha256 })
    .returning({ id: judgment.id });
  if (row !== undefined) {
    const blank = pages.filter((p) => coverage(p.text) < DEFAULT_MIN_PAGE_CHARS);
    if (blank.length > 0) {
      await deps.db
        .insert(corpusOcrQueue)
        .values(blank.map((p) => ({ judgmentId: row.id, pageNo: p.pageNo })))
        .onConflictDoNothing();
    }
    return { status: 'inserted', judgmentId: row.id, sha256, pages: pages.length };
  }

  // Lost a race with a concurrent ingest of the same bytes.
  const [winner] = await deps.db
    .select({ id: judgment.id })
    .from(judgment)
    .where(eq(judgment.sha256, sha256))
    .limit(1);
  if (winner === undefined) return { status: 'unreadable', sha256, pages: 0 };
  return { status: 'duplicate', judgmentId: winner.id, sha256, pages: 0 };
}
