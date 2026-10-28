// The dates of a holiday-list notice document (#628, D-048): one holiday per text line carrying a
// day-first date (`26.01.2026`, `26-Jan-2026`, `26th January 2026`), the rest of the line being the
// holiday's name. The same line reader serves a PDF text layer, an HTML page and plain text. Pure and
// total: an unreadable line is skipped and nothing here throws on bad input.
import { layoutFromHtml, layoutFromPdf, normaliseDate } from '@causedeck/adapters';

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

/** Parse text lines (reading order) of a holiday list; the first date of a line names its holiday. */
export function parseHolidayListLines(lines: readonly string[]): HolidayDate[] {
  const seen = new Set<string>();
  const dates: HolidayDate[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim().replace(SERIAL, '');
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
