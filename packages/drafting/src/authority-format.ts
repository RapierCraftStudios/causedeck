// The canonical paragraph for a corpus authority a lawyer inserts into a draft (#1142):
// `"<quote>" — <masked title>, <citation>, para N`. It lives outside `citations/`, which only labels
// what an author wrote. `extractFromText` reads this form back: the leading quote, the title as the
// citation's title hint, the citation and its pinpoint.

export interface AuthorityParagraphInput {
  /** The words quoted from the judgment's stored text. */
  quote: string;
  /** The stored (masked) case title; omitted when the corpus holds none. */
  title?: string | null | undefined;
  /** The neutral citation, else the stored case number. */
  citation: string;
  para?: number | undefined;
  paraEnd?: number | undefined;
  page?: number | undefined;
}

/**
 * Whitespace collapsed; a straight double quote inside the quote becomes a curly one (the extractor's
 * quote ends at the first straight double quote, and quote checks treat curly and straight alike).
 */
export function canonicalAuthorityQuote(quote: string): string {
  return quote
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s([{])"/g, '$1“')
    .replace(/"/g, '”');
}

function pinpointText(input: AuthorityParagraphInput): string {
  if (input.para !== undefined) {
    return input.paraEnd !== undefined && input.paraEnd > input.para
      ? `, paras ${String(input.para)}-${String(input.paraEnd)}`
      : `, para ${String(input.para)}`;
  }
  if (input.page !== undefined) return `, at p. ${String(input.page)}`;
  return '';
}

export function formatAuthorityParagraph(input: AuthorityParagraphInput): string {
  const title = input.title?.replace(/\s+/g, ' ').trim();
  const head = title === undefined || title === '' ? '' : `${title}, `;
  return `"${canonicalAuthorityQuote(input.quote)}" — ${head}${input.citation.trim()}${pinpointText(input)}`;
}
