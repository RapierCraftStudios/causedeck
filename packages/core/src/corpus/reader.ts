// The in-app judgment reader's read path (#1191). A source link in Research, the copilot or the
// drafting studio opens a stored judgment inside CauseDeck at its cited page; this returns what that
// page shows: the citable header (the title as published, or its masked form per D-053, the neutral
// citation, court, date and bench) and the anonymised text per page, split into the court's
// paragraphs. Only `redacted_text` is served (ADR 0051, D-053): `page_text` is never read here, and a
// judgment that is not yet redacted reads as absent, so nothing unmasked reaches the reader. The
// `judgment` table is the global public corpus (no workspace_id, no RLS), the same for every
// workspace. `hasPdf` says whether the original PDF is in our blob store and may be served; the key
// itself stays server-side. The original PDF carries the unmasked names, so a judgment whose title is
// masked or that falls in a sensitive category never offers it (D-053).
import { db as appDb, schema, type Queryable } from '@causedeck/db';
import { splitParagraphs } from '@causedeck/intelligence';
import { eq } from 'drizzle-orm';

const { judgment } = schema;

export interface ReaderParagraph {
  /** The court's paragraph number when the paragraph opens with one. */
  number: number | null;
  text: string;
}

export interface ReaderPage {
  pageNo: number;
  paragraphs: ReaderParagraph[];
}

export interface JudgmentForReader {
  id: string;
  /** The case title as published, or its masked form when `titleMasked`; null when none is stored. */
  title: string | null;
  titleMasked: boolean;
  neutralCitation: string | null;
  caseNumbers: string[];
  court: string;
  courtLevel: string | null;
  judgmentDate: string | null;
  bench: string[];
  /** The original PDF is stored (`blob_key`); the download route signs it. */
  hasPdf: boolean;
  pages: ReaderPage[];
}

/** The stored judgment for the reader, or null when there is none or it is not yet redacted. */
export async function getJudgmentForReader(
  id: string,
  { db = appDb }: { db?: Queryable } = {},
): Promise<JudgmentForReader | null> {
  const [row] = await db
    .select({
      id: judgment.id,
      caseTitle: judgment.caseTitle,
      titleMasked: judgment.titleMasked,
      neutralCitation: judgment.neutralCitation,
      caseNumbers: judgment.caseNumbers,
      court: judgment.court,
      courtLevel: judgment.courtLevel,
      judgmentDate: judgment.judgmentDate,
      bench: judgment.bench,
      blobKey: judgment.blobKey,
      sensitiveCategory: judgment.sensitiveCategory,
      redactedText: judgment.redactedText,
    })
    .from(judgment)
    .where(eq(judgment.id, id))
    .limit(1);
  if (row?.redactedText == null) return null;
  return {
    id: row.id,
    title: row.caseTitle === null || row.caseTitle.trim() === '' ? null : row.caseTitle,
    titleMasked: row.titleMasked,
    neutralCitation: row.neutralCitation,
    caseNumbers: row.caseNumbers,
    court: row.court,
    courtLevel: row.courtLevel,
    judgmentDate: row.judgmentDate,
    bench: row.bench,
    hasPdf: servablePdf(row) !== null,
    pages: [...row.redactedText]
      .sort((a, b) => a.pageNo - b.pageNo)
      .map((page) => ({
        pageNo: page.pageNo,
        paragraphs: splitParagraphs(page.text)
          .map((p) => ({ number: p.number, text: p.text.trim() }))
          .filter((p) => p.text !== ''),
      })),
  };
}

interface PdfColumns {
  blobKey: string | null;
  titleMasked: boolean;
  sensitiveCategory: string | null;
}

/** The PDF key when the original may be served: stored, title not masked, not sensitive. */
function servablePdf(row: PdfColumns): string | null {
  if (row.blobKey === null || row.blobKey === '') return null;
  if (row.titleMasked || row.sensitiveCategory !== null) return null;
  return row.blobKey;
}

/** The stored PDF's object key, or null when it is not stored or may not be served. Server-only. */
export async function getJudgmentPdfKey(
  id: string,
  { db = appDb }: { db?: Queryable } = {},
): Promise<string | null> {
  const [row] = await db
    .select({
      blobKey: judgment.blobKey,
      titleMasked: judgment.titleMasked,
      sensitiveCategory: judgment.sensitiveCategory,
      redactedText: judgment.redactedText,
    })
    .from(judgment)
    .where(eq(judgment.id, id))
    .limit(1);
  // An unredacted judgment is not served at all, its PDF included (D-053).
  if (row?.redactedText == null) return null;
  return servablePdf(row);
}
