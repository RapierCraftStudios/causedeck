// Karnataka HC advocate keys (#404, part 1 of #37). The official dated cause-list search takes a
// Bar Registration Number (research/raw/09 §1.2), so a BRN printed on a row is the stable key. Its
// format is unverified (ADR 0018): the pattern is tolerant, `KAR/1234/2010`-like, case and spaces
// around the slashes ignored. Names are kept raw plus upper-case aliases with titles stripped and
// initials split; they are never transliterated.
import type { Advocate } from '../types.ts';

const BRN = /\b([A-Za-z]{2,5})\s*\/\s*(\d{1,6})\s*\/\s*(\d{4})\b/;

const TITLES = new Set([
  'SRI',
  'SHRI',
  'SMT',
  'KUM',
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
  'FOR',
]);

export interface KarnatakaAdvocateDiagnostic {
  code: 'advocate_columns_missing';
}

/** The Bar Registration Number in `text`, upper-case without spaces, or null. */
export function extractBarRegistrationNo(text: string): string | null {
  const match = BRN.exec(text);
  if (match === null) return null;
  return `${(match[1] ?? '').toUpperCase()}/${match[2] ?? ''}/${match[3] ?? ''}`;
}

/**
 * Normalised spellings of a name: upper case, BRN and titles removed, initials split.
 * `Sri. A.B. Fictional` gives `['A B FICTIONAL', 'FICTIONAL A B']`.
 */
export function karnatakaAdvocateAliases(raw: string): string[] {
  const words = raw
    .replace(BRN, ' ')
    .toUpperCase()
    .replace(/\bM\/S\b/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !TITLES.has(word));
  if (words.length === 0) return [];
  const initials = words.filter((word) => word.length === 1);
  const names = words.filter((word) => word.length > 1);
  return [...new Set([[...initials, ...names].join(' '), [...names, ...initials].join(' ')])];
}

/** One advocate as printed; the BRN, when present, is the `enrolmentNo` key. */
export function parseKarnatakaAdvocate(raw: string): Advocate {
  const text = raw.trim();
  const enrolmentNo = extractBarRegistrationNo(text);
  const aliases = karnatakaAdvocateAliases(text);
  return enrolmentNo === null ? { raw: text, aliases } : { raw: text, aliases, enrolmentNo };
}

/** The key an advocate is matched by: the BRN, else the first alias. */
export function karnatakaAdvocateKey(advocate: Advocate): string | null {
  return advocate.enrolmentNo ?? advocate.aliases[0] ?? null;
}

/**
 * The advocates in a row's advocate cells (several names per cell split on `,`, `;` and `&`). A row
 * with no advocate columns still parses: `advocates: []` and an `advocate_columns_missing`
 * diagnostic.
 */
export function parseKarnatakaAdvocates(cells: readonly string[] | undefined): {
  advocates: Advocate[];
  diagnostics: KarnatakaAdvocateDiagnostic[];
} {
  if (cells === undefined || cells.length === 0) {
    return { advocates: [], diagnostics: [{ code: 'advocate_columns_missing' }] };
  }
  const advocates = cells
    .flatMap((cell) => cell.split(/\s*[,;&]\s*/))
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(parseKarnatakaAdvocate)
    .filter((advocate) => advocate.aliases.length > 0 || advocate.enrolmentNo !== undefined);
  return { advocates, diagnostics: [] };
}
