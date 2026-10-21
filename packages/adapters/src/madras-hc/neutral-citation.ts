// Madras HC neutral citation (#398). Since 1 Jan 2023 judgments carry `Year/MHC/number`; whether the
// printed separator is a colon or a slash is unverified (research/raw/08 §5), so both are read, with
// any spacing. The canonical form is `YYYY:MHC:n` without leading zeros; `raw` keeps the citation as
// printed. The shared `normaliseNeutralCitation` stays colon-only for the other High Courts. This
// only reads a citation already printed on the document: it never makes one up.

export const MADRAS_NEUTRAL_CITATION = /\b(\d{4})\s*([:/])\s*MHC\s*[:/]\s*(\d{1,7})\b/i;

export interface MadrasNeutralCitation {
  /** `2026:MHC:1234`. */
  normalised: string;
  /** The citation verbatim, with its printed separator. */
  raw: string;
  separator: ':' | '/';
  /** Offset of `raw` in the searched text. */
  index: number;
}

/** The first Madras HC neutral citation in `text`, or null. */
export function findNeutralCitation(text: string): MadrasNeutralCitation | null {
  const match = MADRAS_NEUTRAL_CITATION.exec(text);
  if (match === null) return null;
  const number = (match[3] ?? '').replace(/^0+(?=\d)/, '');
  return {
    normalised: `${match[1] ?? ''}:MHC:${number}`,
    raw: match[0],
    separator: match[2] === '/' ? '/' : ':',
    index: match.index,
  };
}
