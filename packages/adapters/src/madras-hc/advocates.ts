// Advocate matching keys (#395, part 1 of #36). The court's own search takes a Bar enrolment number
// in the form `MS/123/1900` (research/raw/08 §2), the stable key when a list prints it. Names are kept
// raw plus upper-case aliases with titles stripped and initials split; they are never transliterated
// (research/raw/08, implication 8).
import type { Advocate } from '../types.ts';

const ENROLMENT = /\b([A-Za-z]{1,3})\s*\/\s*(\d{1,6})\s*\/\s*((?:19|20)\d{2})\b/;

const TITLES = new Set([
  'MR',
  'MRS',
  'MS',
  'MISS',
  'DR',
  'M/S',
  'ADV',
  'ADVOCATE',
  'ADVOCATES',
  'SR',
  'SENIOR',
  'COUNSEL',
  'THIRU',
  'TMT',
  'SELVI',
  'FOR',
]);

/** The enrolment number in `text`, upper-case without spaces (`ms / 123/1900` -> `MS/123/1900`). */
export function extractEnrolmentNo(text: string): string | null {
  const match = ENROLMENT.exec(text);
  if (match === null) return null;
  return `${(match[1] ?? '').toUpperCase()}/${match[2] ?? ''}/${match[3] ?? ''}`;
}

/**
 * Normalised spellings of a name: upper case, enrolment number and titles removed, initials split.
 * `Mr. R. Fictional` and `R. FICTIONAL, Adv.` both give `['R FICTIONAL', 'FICTIONAL R']`.
 */
export function advocateAliases(raw: string): string[] {
  const words = raw
    .replace(ENROLMENT, ' ')
    .toUpperCase()
    .replace(/\bM\/S\b/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !TITLES.has(word));
  if (words.length === 0) return [];
  const initials = words.filter((word) => word.length === 1);
  const names = words.filter((word) => word.length > 1);
  const aliases = [[...initials, ...names].join(' '), [...names, ...initials].join(' ')];
  return [...new Set(aliases)];
}

/** One advocate as printed: raw text, aliases and the enrolment number when present. */
export function parseAdvocate(raw: string): Advocate {
  const text = raw.trim();
  const enrolmentNo = extractEnrolmentNo(text);
  return enrolmentNo === null
    ? { raw: text, aliases: advocateAliases(text) }
    : { raw: text, aliases: advocateAliases(text), enrolmentNo };
}

/** The key an advocate is matched by: the enrolment number, else the first alias. */
export function advocateKey(advocate: Advocate): string | null {
  return advocate.enrolmentNo ?? advocate.aliases[0] ?? null;
}
