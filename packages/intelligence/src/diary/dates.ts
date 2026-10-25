// Date presence (#52, #46-style rule): a date a model returns is kept only when it literally appears
// in the OCR text it was read from, as digits (`12/10/2026`, `12-10-26`, `௧௨/௧௦/௨௦௨௬`) or with a
// month name (`12 Oct 2026`, `October 12`, `12 அக்டோபர்`, `12 ಅಕ್ಟೋಬರ್`). A day and month with no year
// match any year; a year that is written must match. Otherwise the date is rejected.

/** Month names by month number (1-12): English, Tamil and Kannada, longest first. */
const MONTH_NAMES: readonly (readonly string[])[] = [
  ['january', 'jan', 'ஜனவரி', 'ಜನವರಿ'],
  ['february', 'feb', 'பிப்ரவரி', 'ಫೆಬ್ರವರಿ'],
  ['march', 'mar', 'மார்ச்', 'ಮಾರ್ಚ್'],
  ['april', 'apr', 'ஏப்ரல்', 'ಏಪ್ರಿಲ್'],
  ['may', 'மே', 'ಮೇ'],
  ['june', 'jun', 'ஜூன்', 'ಜೂನ್'],
  ['july', 'jul', 'ஜூலை', 'ಜುಲೈ', 'ಜೂಲೈ'],
  ['august', 'aug', 'ஆகஸ்ட்', 'ಆಗಸ್ಟ್'],
  ['september', 'sept', 'sep', 'செப்டம்பர்', 'ಸೆಪ್ಟೆಂಬರ್'],
  ['october', 'oct', 'அக்டோபர்', 'ಅಕ್ಟೋಬರ್'],
  ['november', 'nov', 'நவம்பர்', 'ನವೆಂಬರ್'],
  ['december', 'dec', 'டிசம்பர்', 'ಡಿಸೆಂಬರ್'],
];

const DIGIT_BASES: readonly number[] = [
  0x0966, // Devanagari
  0x0be6, // Tamil
  0x0ce6, // Kannada
];

/** ASCII digits for Tamil, Kannada and Devanagari numerals; the rest of the text is unchanged. */
export function asciiDigits(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const base = DIGIT_BASES.find((b) => code >= b && code < b + 10);
    out += base === undefined ? ch : String(code - base);
  }
  return out;
}

interface Written {
  day: number;
  month: number;
  year: number | null;
}

const MONTH_ALT = MONTH_NAMES.flatMap((names, i) =>
  names.map((name) => ({ name, month: i + 1 })),
).sort((a, b) => b.name.length - a.name.length);
const MONTH_PATTERN = MONTH_ALT.map((m) => m.name).join('|');
const ORDINAL = '(?:st|nd|rd|th)?';
const NOT_LETTER_BEFORE = '(?<![\\p{L}\\p{M}\\d])';
const NOT_LETTER_AFTER = '(?![\\p{L}\\p{M}])';

const NUMERIC = /(?<!\d)(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?:\s*[/\-.]\s*(\d{4}|\d{2}))?(?!\d)/gu;
const DAY_MONTH = new RegExp(
  `${NOT_LETTER_BEFORE}(\\d{1,2})${ORDINAL}\\s*(?:of\\s+)?(${MONTH_PATTERN})\\.?${NOT_LETTER_AFTER}(?:[\\s,.]*(\\d{4}|\\d{2})(?!\\d))?`,
  'giu',
);
const MONTH_DAY = new RegExp(
  `${NOT_LETTER_BEFORE}(${MONTH_PATTERN})\\.?\\s*(\\d{1,2})${ORDINAL}(?!\\d)(?:[\\s,.]*(\\d{4})(?!\\d))?`,
  'giu',
);

function monthOf(name: string): number {
  const lower = name.toLowerCase();
  return MONTH_ALT.find((m) => m.name === lower)?.month ?? 0;
}

function year(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  const value = Number.parseInt(raw, 10);
  return raw.length === 2 ? 2000 + value : value;
}

/** Every day-month(-year) written in `text`. */
export function writtenDates(text: string): Written[] {
  const source = asciiDigits(text).normalize('NFC');
  const found: Written[] = [];
  for (const m of source.matchAll(NUMERIC)) {
    found.push({ day: Number(m[1]), month: Number(m[2]), year: year(m[3]) });
  }
  for (const m of source.matchAll(DAY_MONTH)) {
    found.push({ day: Number(m[1]), month: monthOf(m[2] ?? ''), year: year(m[3]) });
  }
  for (const m of source.matchAll(MONTH_DAY)) {
    found.push({ day: Number(m[2]), month: monthOf(m[1] ?? ''), year: year(m[3]) });
  }
  return found;
}

/** Whether the ISO date `iso` (`YYYY-MM-DD`) is literally written in `text`. */
export function datePresence(iso: string, text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return false;
  }
  return writtenDates(text).some(
    (w) => w.day === d && w.month === mo && (w.year === null || w.year === y),
  );
}
