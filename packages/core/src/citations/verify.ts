// Citation verification (#484, D-004, D-048): resolve a neutral citation (Madras HC `2026:MHC:1234`
// or `2026/MHC/1234`, Karnataka HC `2026:KHC-D:567`, Supreme Court `2026 INSC 12`) to a stored
// judgment in the raw corpus, with the pages the citation is printed on as anchors, or mark it
// UNVERIFIED. A citation this cannot read or find is never guessed at. `judgment` is a global
// table, so the answer is the same in every workspace.
import { db as appDb, schema, type Queryable } from '@causedeck/db';
import { canonicalNeutralCitation } from '@causedeck/intelligence';
import { eq } from 'drizzle-orm';

const { judgment, ANCHOR_QUOTE_MAX } = schema;

/** A page of the judgment that carries the citation, with the line it is printed on. */
export interface CitationAnchor {
  pageNo: number;
  quote: string;
}

export type CitationVerification =
  | {
      status: 'VERIFIED';
      /** The canonical neutral citation that matched. */
      citation: string;
      judgmentId: string;
      court: string;
      judgmentDate: string | null;
      sourceUrl: string;
      anchors: CitationAnchor[];
    }
  | { status: 'UNVERIFIED'; citation: string | null; reason: 'unreadable' | 'not_in_corpus' };

function anchorsOf(pages: schema.JudgmentPageText[], citation: string): CitationAnchor[] {
  const anchors: CitationAnchor[] = [];
  for (const page of pages) {
    for (const line of page.text.split('\n')) {
      if (canonicalNeutralCitation(line) !== citation) continue;
      anchors.push({ pageNo: page.pageNo, quote: line.trim().slice(0, ANCHOR_QUOTE_MAX) });
      break;
    }
  }
  return anchors;
}

/** Resolve `raw` to a corpus judgment (VERIFIED, with page anchors) or UNVERIFIED. */
export async function verifyCitation(
  raw: string,
  { db = appDb }: { db?: Queryable } = {},
): Promise<CitationVerification> {
  const citation = canonicalNeutralCitation(raw);
  if (citation === null) return { status: 'UNVERIFIED', citation: null, reason: 'unreadable' };
  const [row] = await db
    .select()
    .from(judgment)
    .where(eq(judgment.neutralCitation, citation))
    .limit(1);
  if (row === undefined) return { status: 'UNVERIFIED', citation, reason: 'not_in_corpus' };
  const anchors = anchorsOf(row.pageText, citation);
  return {
    status: 'VERIFIED',
    citation,
    judgmentId: row.id,
    court: row.court,
    judgmentDate: row.judgmentDate,
    sourceUrl: row.provenance.url,
    // A citation printed only in a running header the layer missed still resolves: anchor page 1.
    anchors: anchors.length > 0 ? anchors : [{ pageNo: 1, quote: citation }],
  };
}
