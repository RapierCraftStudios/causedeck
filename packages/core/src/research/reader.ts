// The judgment reader (#1174, part 1 of #1170; D-053): one judgment's redacted pages for the research
// reader, with the anchor of a paragraph or page pinpoint, the source attribution (URL and licence)
// and the stored title (already masked when `title_masked`). Only `redacted_text` is read, never
// the raw page text; a judgment that is not redacted yet is not served (null, like a missing one). Each page
// says whether its page number is `verified` (PDF text layer or OCR) or `page_pending` (plain-text
// import). Member-checked like the search; unmetered and unaudited: global public corpus, no tenant row.
import { isUuid, schema, type Queryable } from '@causedeck/db';
import { splitParagraphs } from '@causedeck/intelligence';
import { eq, sql } from 'drizzle-orm';

import { invalid } from '../shared/errors.ts';

import { asMember, type ResearchSearchActor } from './search.ts';

const { judgment } = schema;

export interface JudgmentReaderPage {
  pageNo: number;
  /** The redacted text of the page. */
  text: string;
  pinpoint: 'verified' | 'page_pending';
}

export interface JudgmentReaderAnchor {
  /** The page the pinpoint lands on. */
  page: number;
  /** The paragraph number asked for, when the judgment numbers its paragraphs and has it. */
  para: number | null;
  /** Character offset of the paragraph in its page's text (0 for a page pinpoint). */
  offset: number;
  pinpoint: 'verified' | 'page_pending';
}

export interface JudgmentReaderView {
  judgmentId: string;
  /** `judgment.case_title`: already the masked form when `titleMasked` (D-053). */
  title: string | null;
  titleMasked: boolean;
  neutralCitation: string | null;
  court: string;
  courtLevel: string | null;
  judgmentDate: string | null;
  outcome: string;
  /** Judges on the bench; null when the header named none. */
  benchStrength: number | null;
  pages: JudgmentReaderPage[];
  /** Where `para` or `page` lands; null when neither was asked for or it is not in the text. */
  anchor: JudgmentReaderAnchor | null;
  attribution: { sourceUrl: string | null; licence: string | null };
}

export interface JudgmentReaderInput {
  judgmentId: string;
  /** A paragraph pinpoint (`para 12`). */
  para?: number;
  /** A page pinpoint; used when `para` is absent or not found. */
  page?: number;
}

const PAGE_SEPARATOR = '\n\n';

function anchorOf(pages: readonly JudgmentReaderPage[], input: JudgmentReaderInput): JudgmentReaderAnchor | null {
  if (input.para !== undefined) {
    // The same joined text and paragraph split as `verifyPinpoint`, so an anchor it verified lands here.
    const starts: number[] = [];
    let at = 0;
    for (const p of pages) {
      starts.push(at);
      at += p.text.length + PAGE_SEPARATOR.length;
    }
    const paragraph = splitParagraphs(pages.map((p) => p.text).join(PAGE_SEPARATOR)).find(
      (p) => p.number === input.para,
    );
    if (paragraph !== undefined) {
      let index = 0;
      for (let i = 0; i < starts.length; i += 1) if ((starts[i] ?? 0) <= paragraph.start) index = i;
      const page = pages[index];
      if (page !== undefined) {
        return {
          page: page.pageNo,
          para: input.para,
          offset: Math.min(paragraph.start - (starts[index] ?? 0), page.text.length),
          pinpoint: page.pinpoint,
        };
      }
    }
  }
  if (input.page !== undefined) {
    const page = pages.find((p) => p.pageNo === input.page);
    if (page !== undefined) {
      return { page: page.pageNo, para: null, offset: 0, pinpoint: page.pinpoint };
    }
  }
  return null;
}

const positiveInt = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

/** One redacted judgment for the reader; null when it is not stored or not redacted yet. */
export async function getJudgmentReaderView(
  db: Queryable,
  actor: ResearchSearchActor,
  input: JudgmentReaderInput,
): Promise<JudgmentReaderView | null> {
  if (input.para !== undefined && !positiveInt(input.para)) throw invalid('Invalid paragraph');
  if (input.page !== undefined && !positiveInt(input.page)) throw invalid('Invalid page');
  return asMember(db, actor, async () => {
    if (!isUuid(input.judgmentId)) return null;
    // The raw page text is never selected (D-053).
    const [row] = await db
      .select({
        id: judgment.id,
        caseTitle: judgment.caseTitle,
        titleMasked: judgment.titleMasked,
        neutralCitation: judgment.neutralCitation,
        court: judgment.court,
        courtLevel: judgment.courtLevel,
        judgmentDate: judgment.judgmentDate,
        outcome: judgment.outcome,
        bench: sql<number>`cardinality(${judgment.bench})`,
        redactedText: judgment.redactedText,
        redactionVersion: judgment.redactionVersion,
        url: sql<string | null>`${judgment.provenance}->>'url'`,
        licence: sql<string | null>`${judgment.provenance}->>'licence'`,
      })
      .from(judgment)
      .where(eq(judgment.id, input.judgmentId))
      .limit(1);
    if (row === undefined || row.redactionVersion <= 0 || row.redactedText === null) return null;
    const pages: JudgmentReaderPage[] = [...row.redactedText]
      .sort((a, b) => a.pageNo - b.pageNo)
      .map((p) => ({
        pageNo: p.pageNo,
        text: p.text,
        pinpoint: p.source === 'text' ? 'page_pending' : 'verified',
      }));
    const bench = row.bench;
    return {
      judgmentId: row.id,
      title: row.caseTitle,
      titleMasked: row.titleMasked,
      neutralCitation: row.neutralCitation,
      court: row.court,
      courtLevel: row.courtLevel,
      judgmentDate: row.judgmentDate,
      outcome: row.outcome,
      benchStrength: bench > 0 ? bench : null,
      pages,
      anchor: anchorOf(pages, input),
      attribution: { sourceUrl: row.url, licence: row.licence },
    };
  });
}
