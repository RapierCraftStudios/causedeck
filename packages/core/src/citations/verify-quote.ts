// Pinpoint and quote check (#1135, part 3 of #1117; D-053, ADR 0051): does the cited paragraph (or
// page, when the judgment has no paragraph numbers) exist, and does the quoted span occur in it?
// Only `judgment.redacted_text` is read; `page_text` never is. The answer is a status alone: no
// paragraph, page or quote text leaves this function, and nothing is audited or logged.
import { db as appDb, schema, type Queryable } from '@causedeck/db';
import { splitParagraphs } from '@causedeck/intelligence';
import { eq } from 'drizzle-orm';

const { judgment } = schema;

/** Where in the judgment, and the words the draft quotes from it. */
export interface PinpointQuery {
  para?: number | undefined;
  paraEnd?: number | undefined;
  page?: number | undefined;
  quote?: string | undefined;
}

export type PinpointStatus = 'verified' | 'pinpoint_not_found' | 'quote_not_found';

export interface PinpointCheck {
  status: PinpointStatus;
}

const QUOTE_MARKS = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTE_MARKS = /[“”„‟″«»]/g;

/** Unicode-compatible, straight quote marks, collapsed whitespace, lower case. */
export function normaliseQuoteText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(QUOTE_MARKS, "'")
    .replace(DOUBLE_QUOTE_MARKS, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The quote without the quote marks around it. */
function quoteBody(quote: string): string {
  return normaliseQuoteText(quote)
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

/** The passage a pinpoint names, or null when that paragraph or page is not in the text. */
function passageOf(pages: readonly schema.JudgmentPageText[], query: PinpointQuery): string | null {
  const ordered = [...pages].sort((a, b) => a.pageNo - b.pageNo);
  const full = ordered.map((p) => p.text).join('\n\n');
  const paragraphs = splitParagraphs(full);
  const numbered = paragraphs.some((p) => p.number !== null);
  if (query.para !== undefined && numbered) {
    const from = query.para;
    const to = query.paraEnd ?? from;
    const hit = paragraphs.filter((p) => p.number !== null && p.number >= from && p.number <= to);
    return hit.length === 0 ? null : hit.map((p) => p.text).join('\n');
  }
  if (query.page !== undefined) {
    const page = ordered.find((p) => p.pageNo === query.page);
    return page === undefined ? null : page.text;
  }
  // A paragraph pinpoint into a text without paragraph numbers, and no page to fall back to.
  if (query.para !== undefined || query.paraEnd !== undefined) return null;
  return full;
}

/**
 * `verified` when the pinpointed paragraph (or page) exists and, if a quote is given, the normalised
 * quote occurs in it; `pinpoint_not_found` when the passage is absent (or the judgment has no
 * redacted text yet); `quote_not_found` when the passage exists but the quote is not in it.
 */
export async function verifyPinpoint(
  judgmentId: string,
  query: PinpointQuery,
  { db = appDb }: { db?: Queryable } = {},
): Promise<PinpointCheck> {
  const [row] = await db
    .select({ redactedText: judgment.redactedText })
    .from(judgment)
    .where(eq(judgment.id, judgmentId))
    .limit(1);
  const pages = row?.redactedText;
  if (pages === null || pages === undefined || pages.length === 0) {
    return { status: 'pinpoint_not_found' };
  }
  const passage = passageOf(pages, query);
  if (passage === null) return { status: 'pinpoint_not_found' };
  if (query.quote === undefined) return { status: 'verified' };
  const quote = quoteBody(query.quote);
  if (quote === '') return { status: 'quote_not_found' };
  return {
    status: normaliseQuoteText(passage).includes(quote) ? 'verified' : 'quote_not_found',
  };
}
