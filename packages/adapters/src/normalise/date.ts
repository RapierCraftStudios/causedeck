// Date normaliser (#369). Indian courts print day-first dates: `21.10.2026`, `21-10-2026`,
// `21/10/26`, `21 Oct 2026`, `21st October, 2026`, `21-OCT-2026`. The result is an ISO calendar
// date (`2026-10-21`) or null for anything that is not a real date.
import { expandYear, type YearOptions } from './case-number.ts';

const MONTH_NAMES = [
  ['jan', 'january'],
  ['feb', 'february'],
  ['mar', 'march'],
  ['apr', 'april'],
  ['may'],
  ['jun', 'june'],
  ['jul', 'july'],
  ['aug', 'august'],
  ['sep', 'sept', 'september'],
  ['oct', 'october'],
  ['nov', 'november'],
  ['dec', 'december'],
];

const NUMERIC = /\b(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})\b/;
const WORDED =
  /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+(?:day\s+of\s+)?([A-Za-z]{3,9})\.?,?[\s-]+(\d{4})\b/;

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first day-first date in `raw` as `YYYY-MM-DD`, or null. */
export function normaliseDate(raw: string, options: YearOptions = {}): string | null {
  const numeric = NUMERIC.exec(raw);
  if (numeric !== null) {
    const year = expandYear(numeric[3] ?? '', options);
    return year === null ? null : iso(year, Number(numeric[2]), Number(numeric[1]));
  }
  const worded = WORDED.exec(raw);
  if (worded === null) return null;
  const name = (worded[2] ?? '').toLowerCase();
  const month = MONTH_NAMES.findIndex((names) => names.includes(name)) + 1;
  const year = expandYear(worded[3] ?? '', options);
  return month === 0 || year === null ? null : iso(year, month, Number(worded[1]));
}
