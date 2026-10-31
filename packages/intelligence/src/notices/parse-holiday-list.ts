// The dates of a holiday-list notice document (#628, D-048): one holiday per text line carrying a
// day-first date (`26.01.2026`, `26-Jan-2026`, `26th January 2026`), the rest of the line being the
// holiday's name. The same line reader serves a PDF text layer, an HTML page and plain text. Pure and
// total: an unreadable line is skipped and nothing here throws on bad input.
import { layoutFromHtml, layoutFromPdf, normaliseDate } from '@causedeck/adapters';

export interface VacationDates {
  /** First closed day (ISO date), inclusive. */
  from: string;
  /** Last closed day (ISO date), inclusive. */
  to: string;
  /** The vacation's name as printed; `Court vacation` for a line that prints only the range. */
  name: string;
}

export interface HolidayDate {
  /** ISO calendar date of the holiday. */
  date: string;
  /** The holiday's name as printed; `Holiday` for a line that prints only the date. */
  name: string;
}

const DATE_TOKEN =
  /\b\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}\b|\b\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:day\s+of\s+)?[A-Za-z]{3,9}\.?,?[\s-]+\d{4}\b/;
const SERIAL = /^\s*\d{1,3}[.)]\s+/;
const WEEKDAY = /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b\.?,?/gi;
const NAME_CHARS = 200;
const DATE_TOKEN_ALL = new RegExp(DATE_TOKEN.source, 'g');
const VACATION_WORD = /\b(?:vacations?|recess)\b/i;
const RANGE_JOINER = /^\s*(?:to|till|until|through|thru|and|[-–—])\s*$/i;
const FROM_WORD = /\b(?:from|w\.?e\.?f\.?)\s*:?\s*$/i;

/**
 * The vacation range a line states (#650): two day-first dates joined by `to`, `till`, `until`, a dash
 * or `and`, e.g. `Summer vacation from 01.06.2026 to 30.06.2026`. Without `assumeVacation` the line
 * must itself say `vacation` or `recess`, so a holiday spanning days is not read as a vacation. A range
 * that ends before it starts, or a date that does not read, yields null.
 */
export function vacationRangeFromLine(
  raw: string,
  options: { assumeVacation?: boolean } = {},
): VacationDates | null {
  const line = raw.replace(/\s+/g, ' ').trim().replace(SERIAL, '');
  if (options.assumeVacation !== true && !VACATION_WORD.test(line)) return null;
  const tokens = [...line.matchAll(DATE_TOKEN_ALL)];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a === undefined || b === undefined) continue;
    const between = line.slice(a.index + a[0].length, b.index);
    if (!RANGE_JOINER.test(between)) continue;
    const from = normaliseDate(a[0]);
    const to = normaliseDate(b[0]);
    if (from === null || to === null || to < from) continue;
    const before = line.slice(0, a.index).replace(FROM_WORD, ' ');
    const after = line.slice(b.index + b[0].length);
    const name = (before + ' ' + after)
      .replace(WEEKDAY, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s:–|,()-]+|[\s:–|,()-]+$/g, '')
      .slice(0, NAME_CHARS)
      .trim();
    return { from, to, name: name === '' ? 'Court vacation' : name };
  }
  return null;
}

/** Vacation ranges of text lines (reading order), each distinct range once. */
export function parseVacationRangeLines(
  lines: readonly string[],
  options: { assumeVacation?: boolean } = {},
): VacationDates[] {
  const seen = new Set<string>();
  const ranges: VacationDates[] = [];
  for (const line of lines) {
    const range = vacationRangeFromLine(line, options);
    if (range === null) continue;
    const key = `${range.from}/${range.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push(range);
  }
  return ranges;
}

/** Vacation ranges of a plain-text notice document. */
export function parseVacationRangesText(
  text: string,
  options: { assumeVacation?: boolean } = {},
): VacationDates[] {
  return parseVacationRangeLines(text.split(/\r?\n/), options);
}

/** Vacation ranges of a notice HTML page. */
export function parseVacationRangesHtml(
  html: string,
  options: { assumeVacation?: boolean } = {},
): VacationDates[] {
  try {
    const layout = layoutFromHtml(html);
    return parseVacationRangeLines(
      layout.pages.flatMap((page) => pageLines(page)),
      options,
    );
  } catch {
    return [];
  }
}

/** Vacation ranges of a notice PDF through its text layer; an unreadable PDF yields none. */
export async function parseVacationRangesPdf(
  data: Uint8Array,
  options: { assumeVacation?: boolean } = {},
): Promise<VacationDates[]> {
  try {
    const layout = await layoutFromPdf(data);
    return parseVacationRangeLines(
      layout.pages.flatMap((page) => pageLines(page)),
      options,
    );
  } catch {
    return [];
  }
}

/**
 * Parse text lines (reading order) of a holiday list; the first date of a line names its holiday. A
 * line that states a vacation range (#650) is not a holiday and is skipped here.
 */
export function parseHolidayListLines(lines: readonly string[]): HolidayDate[] {
  const seen = new Set<string>();
  const dates: HolidayDate[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim().replace(SERIAL, '');
    if (vacationRangeFromLine(line) !== null) continue;
    const token = DATE_TOKEN.exec(line);
    if (token === null) continue;
    const date = normaliseDate(token[0]);
    if (date === null || seen.has(date)) continue;
    const name = (line.slice(0, token.index) + ' ' + line.slice(token.index + token[0].length))
      .replace(WEEKDAY, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s:–|,-]+|[\s:–|,-]+$/g, '')
      .slice(0, NAME_CHARS)
      .trim();
    seen.add(date);
    dates.push({ date, name: name === '' ? 'Holiday' : name });
  }
  return dates;
}

/** Parse a holiday-list HTML page. */
export function parseHolidayListHtml(html: string): HolidayDate[] {
  try {
    const layout = layoutFromHtml(html);
    return parseHolidayListLines(layout.pages.flatMap((page) => pageLines(page)));
  } catch {
    return [];
  }
}

/** Parse a holiday-list PDF through its text layer; an unreadable PDF yields no dates. */
export async function parseHolidayListPdf(data: Uint8Array): Promise<HolidayDate[]> {
  try {
    const layout = await layoutFromPdf(data);
    return parseHolidayListLines(layout.pages.flatMap((page) => pageLines(page)));
  } catch {
    return [];
  }
}

/** Parse a plain-text holiday list. */
export function parseHolidayListText(text: string): HolidayDate[] {
  return parseHolidayListLines(text.split(/\r?\n/));
}

function pageLines(page: { items: readonly { text: string }[]; text: string }): string[] {
  return page.items.length > 0 ? page.items.map((item) => item.text) : page.text.split('\n');
}
