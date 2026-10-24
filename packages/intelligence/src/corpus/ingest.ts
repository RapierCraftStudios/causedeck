// Judgment ingestion (#484, D-048): fetch one judgment PDF through the governed fetch layer, read its
// text layer per page, extract the header and store one global `judgment` row. The fetcher is a
// structural port (`@causedeck/fetch`'s `Fetcher` satisfies it), so every external read stays behind
// the registry, tier caps and kill switch, and this package imports no fetch code. Re-ingesting the
// same bytes is a no-op: the sha256 of the body is the dedupe key.
import { schema, type Queryable } from '@causedeck/db';
import { eq } from 'drizzle-orm';

import { readPdfText, type PdfPageText } from '../text/pdf-text.ts';

import { extractJudgmentHeader } from './header.ts';

const { judgment } = schema;

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

export interface IngestDeps {
  db: Queryable;
  fetcher: CorpusFetcher;
  /** Defaults to `readPdfText`; tests pass a fake. */
  readPdf?: (data: Uint8Array) => Promise<PdfPageText[]>;
}

export type IngestOutcome =
  | { status: 'inserted' | 'duplicate'; judgmentId: string; sha256: string }
  | { status: 'unreadable'; sha256: string };

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
  const { sha256 } = fetched.provenance;

  const [existing] = await deps.db
    .select({ id: judgment.id })
    .from(judgment)
    .where(eq(judgment.sha256, sha256))
    .limit(1);
  if (existing !== undefined) return { status: 'duplicate', judgmentId: existing.id, sha256 };

  let pages: PdfPageText[];
  try {
    pages = await (deps.readPdf ?? readPdfText)(bodyBytes(fetched.body, fetched.contentType));
  } catch {
    return { status: 'unreadable', sha256 };
  }
  const header = extractJudgmentHeader(pages.map((p) => p.text));

  const [row] = await deps.db
    .insert(judgment)
    .values({
      sourceId: input.sourceId,
      court: header.court ?? input.sourceId,
      neutralCitation: header.neutralCitation,
      caseNumbers: header.caseNumbers,
      bench: header.bench,
      judgmentDate: header.judgmentDate,
      sha256,
      provenance: fetched.provenance,
      pageText: pages,
    })
    .onConflictDoNothing({ target: judgment.sha256 })
    .returning({ id: judgment.id });
  if (row !== undefined) return { status: 'inserted', judgmentId: row.id, sha256 };

  // Lost a race with a concurrent ingest of the same bytes.
  const [winner] = await deps.db
    .select({ id: judgment.id })
    .from(judgment)
    .where(eq(judgment.sha256, sha256))
    .limit(1);
  if (winner === undefined) return { status: 'unreadable', sha256 };
  return { status: 'duplicate', judgmentId: winner.id, sha256 };
}
