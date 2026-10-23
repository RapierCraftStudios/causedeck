// Judgment header extraction for the corpus (#484, D-048): the neutral citation, court code, case
// numbers, bench and date, read from the first pages of a judgment or order. It only reads what is
// printed (a citation is never made up) and is pure and total: a header with nothing readable
// yields nulls and empty lists.
import {
  findKarnatakaNeutralCitation,
  findNeutralCitation,
  normaliseDate,
  normaliseNeutralCitation,
} from '@causedeck/adapters';

export interface JudgmentHeader {
  /** Canonical neutral citation, e.g. `2026:MHC:1234`, `2026:KHC:567`, `2026 INSC 12`. */
  neutralCitation: string | null;
  /** Court code of the citation (`MHC`, `KHC`, `KHC-D`, `INSC`), or null without a citation. */
  court: string | null;
  caseNumbers: string[];
  bench: string[];
  /** ISO date from a header label (`DATED`, `Pronounced on`), never from the body. */
  judgmentDate: string | null;
}

/** Pages searched for the header. */
export const HEADER_PAGES = 2;

const DATE_LABEL =
  /^[ \t]*(?:DATED|DATE OF (?:ORDER|JUDGMENT)|PRONOUNCED ON|RESERVED ON|JUDGMENT DELIVERED ON)[ \t]*[:-]?[ \t]*([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{1,2}[ \t]+[A-Za-z]+[ \t]*,?[ \t]+[0-9]{4})/im;
const JUSTICE = /JUSTICE\s+(?:MR\.?|MRS\.?|MS\.?|DR\.?|SMT\.?)?\s*([A-Z][A-Z .'-]{2,60})/g;
const CASE_NUMBER = /\b[A-Z][A-Za-z.()]{0,14}\s*No\.?\s*\d{1,7}\s*(?:of|\/)\s*\d{4}\b/g;

/** The canonical neutral citation (Madras, Karnataka or Supreme Court form) in `text`, or null. */
export function canonicalNeutralCitation(text: string): string | null {
  const madras = findNeutralCitation(text);
  if (madras !== null) return madras.normalised;
  const karnataka = findKarnatakaNeutralCitation(text);
  if (karnataka !== null) return normaliseNeutralCitation(karnataka.raw);
  return normaliseNeutralCitation(text);
}

/** The court code inside a canonical citation. */
export function courtOfCitation(citation: string): string | null {
  if (/^\d{4} INSC \d+$/.test(citation)) return 'INSC';
  const parts = citation.split(':');
  return parts.length === 3 ? (parts[1] ?? null) : null;
}

/** Read the header from the text of the first pages (page 1 first). */
export function extractJudgmentHeader(pages: readonly string[]): JudgmentHeader {
  const head = pages.slice(0, HEADER_PAGES).join('\n');
  const neutralCitation = canonicalNeutralCitation(head);
  const dateMatch = DATE_LABEL.exec(head);
  const bench = [...new Set([...head.matchAll(JUSTICE)].map((m) => (m[1] ?? '').trim()))].filter(
    (name) => name !== '',
  );
  const caseNumbers = [
    ...new Set([...head.matchAll(CASE_NUMBER)].map((m) => m[0].replace(/\s+/g, ' '))),
  ];
  return {
    neutralCitation,
    court: neutralCitation === null ? null : courtOfCitation(neutralCitation),
    caseNumbers,
    bench,
    judgmentDate: dateMatch === null ? null : normaliseDate(dateMatch[1] ?? ''),
  };
}
