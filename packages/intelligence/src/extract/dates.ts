// Date literals (#46; PRD DI-3): the one place that decides whether an absolute date is *in* a
// page's text. A date the model returns survives only if `datePresence` finds a literal rendering of
// it: `12.11.2026`, `12/11/2026`, `12-11-2026`, `12th November, 2026`, `November 12, 2026`,
// `12.11.26`, with ASCII, Tamil, Kannada or Devanagari digits and English, Tamil or Kannada month
// names. Numeric dates are day-first (Indian courts). Everything here is pure; the digit map is
// one character to one character, so every offset into the mapped text is an offset into the
// original.

export interface DateLiteral {
  /** `YYYY-MM-DD`. */
  date: string;
  /** The text as written. */
  literal: string;
  /** Offsets into the text passed in. */
  start: number;
  end: number;
}

const DIGIT_BLOCKS = [0x0966, 0x0be6, 0x0ce6] as const; // Devanagari, Tamil, Kannada zero

/** Indic digits to ASCII, one character each, so offsets are unchanged. */
export function mapIndicDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    const block = DIGIT_BLOCKS.find((zero) => cp >= zero && cp <= zero + 9);
    out += block === undefined ? ch : String(cp - block);
  }
  return out;
}

const EN_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;
const TA_MONTHS = [
  'ஜனவரி',
  'பிப்ரவரி',
  'மார்ச்',
  'ஏப்ரல்',
  'மே',
  'ஜூன்',
  'ஜூலை',
  'ஆகஸ்ட்',
  'செப்டம்பர்',
  'அக்டோபர்',
  'நவம்பர்',
  'டிசம்பர்',
] as const;
const KN_MONTHS = [
  'ಜನವರಿ',
  'ಫೆಬ್ರವರಿ',
  'ಮಾರ್ಚ್',
  'ಏಪ್ರಿಲ್',
  'ಮೇ',
  'ಜೂನ್',
  'ಜುಲೈ',
  'ಆಗಸ್ಟ್',
  'ಸೆಪ್ಟೆಂಬರ್',
  'ಅಕ್ಟೋಬರ್',
  'ನವೆಂಬರ್',
  'ಡಿಸೆಂಬರ್',
] as const;

const MONTH_NUMBER = new Map<string, number>();
EN_MONTHS.forEach((name, i) => {
  MONTH_NUMBER.set(name, i + 1);
  MONTH_NUMBER.set(name.slice(0, 3), i + 1);
});
MONTH_NUMBER.set('sept', 9);
TA_MONTHS.forEach((name, i) => MONTH_NUMBER.set(name, i + 1));
KN_MONTHS.forEach((name, i) => MONTH_NUMBER.set(name, i + 1));

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTH_PATTERN = [...MONTH_NUMBER.keys()]
  .sort((a, b) => b.length - a.length)
  .map(escape)
  .join('|');

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** A real calendar date as `YYYY-MM-DD`, or null. */
export function isoOf(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day > last ? null : `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

const fullYear = (raw: string): number => (raw.length === 2 ? 2000 + Number(raw) : Number(raw));

const NUMERIC = /(?<![\d/.-])(\d{1,2})\s?([./-])\s?(\d{1,2})\s?\2\s?(\d{4}|\d{2})(?![\d])/gu;
const DAY_MONTH = new RegExp(
  `(?<![\\d])(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:day\\s+of\\s+)?(${MONTH_PATTERN})\\.?\\s*,?\\s*(\\d{4})(?![\\d])`,
  'giu',
);
const MONTH_DAY = new RegExp(
  `(?<![\\p{L}])(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})(?![\\d])`,
  'giu',
);

/** Every absolute date written in `text`, in order of position, overlaps removed. */
export function findDateLiterals(text: string): DateLiteral[] {
  const mapped = mapIndicDigits(text);
  const found: DateLiteral[] = [];
  const push = (match: RegExpMatchArray, iso: string | null): void => {
    if (iso === null || match.index === undefined) return;
    found.push({
      date: iso,
      literal: text.slice(match.index, match.index + match[0].length),
      start: match.index,
      end: match.index + match[0].length,
    });
  };
  for (const m of mapped.matchAll(NUMERIC)) {
    push(m, isoOf(fullYear(m[4] ?? ''), Number(m[3]), Number(m[1])));
  }
  for (const m of mapped.matchAll(DAY_MONTH)) {
    push(m, isoOf(Number(m[3]), MONTH_NUMBER.get((m[2] ?? '').toLowerCase()) ?? 0, Number(m[1])));
  }
  for (const m of mapped.matchAll(MONTH_DAY)) {
    push(m, isoOf(Number(m[3]), MONTH_NUMBER.get((m[1] ?? '').toLowerCase()) ?? 0, Number(m[2])));
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: DateLiteral[] = [];
  for (const item of found) {
    const last = kept[kept.length - 1];
    if (last === undefined || item.start >= last.end) kept.push(item);
  }
  return kept;
}

/** The literal rendering of `isoDate` in `pageText`, or null when none exists. */
export function datePresence(isoDate: string, pageText: string): DateLiteral | null {
  return findDateLiterals(pageText).find((literal) => literal.date === isoDate) ?? null;
}

export const DATE_FORMATS = [
  'dd.mm.yyyy',
  'dd/mm/yyyy',
  'dd-mm-yyyy',
  'd Month, yyyy',
  'Month d, yyyy',
  'dd.mm.yy',
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const ORDINAL = (d: number): string => {
  const tail = d % 100;
  if (tail >= 11 && tail <= 13) return `${String(d)}th`;
  return `${String(d)}${['th', 'st', 'nd', 'rd'][d % 10] ?? 'th'}`;
};
const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Write `isoDate` the way an order would; used by tests and the gold generator. */
export function renderDate(isoDate: string, format: DateFormat, digits?: 'ta' | 'kn'): string {
  const [y = 0, m = 0, d = 0] = isoDate.split('-').map(Number);
  const month = titleCase(EN_MONTHS[m - 1] ?? '');
  let out: string;
  switch (format) {
    case 'dd.mm.yyyy':
      out = `${pad(d)}.${pad(m)}.${pad(y, 4)}`;
      break;
    case 'dd/mm/yyyy':
      out = `${pad(d)}/${pad(m)}/${pad(y, 4)}`;
      break;
    case 'dd-mm-yyyy':
      out = `${pad(d)}-${pad(m)}-${pad(y, 4)}`;
      break;
    case 'd Month, yyyy':
      out = `${ORDINAL(d)} ${month}, ${String(y)}`;
      break;
    case 'Month d, yyyy':
      out = `${month} ${String(d)}, ${String(y)}`;
      break;
    case 'dd.mm.yy':
      out = `${pad(d)}.${pad(m)}.${pad(y % 100)}`;
      break;
  }
  if (digits === undefined) return out;
  const zero = digits === 'ta' ? 0x0be6 : 0x0ce6;
  return out.replace(/\d/g, (c) => String.fromCodePoint(zero + Number(c)));
}
