// Karnataka HC cause list from plain text (#1065): a contributed copy of a list page or PDF, copied
// as text. It produces the same list-reader events as the HTML and PDF parsers, so the result has
// the same shape. Pages are split on form feeds. A line whose words spell column names
// (`karnatakaHcColumnOf`, several words per name) is the table header. A line that starts with a
// serial number starts a row: split on tabs or runs of two spaces (what copying a table gives) its
// cells fill the header's columns in order (`itemNo, caseNo, parties` without a header); a row
// flattened to single spaces has its case text read up to the end of the last case reference and
// the rest taken as parties. A line that starts with a tab or two spaces under a known header
// continues the row above (wrapped parties, advocates or case text). Every other line is a line
// (hall, list, judge, stage heading, title). Anchors quote the trimmed line. No I/O.
import type { ParsedCauseList, ParserInput } from '../types.ts';

import { karnatakaHcColumnOf, type KarnatakaHcColumn } from './config/column-synonyms.ts';
import {
  isKarnatakaListLine,
  readKarnatakaList,
  type ListEvent,
  type ListReaderPage,
} from './list-reader.ts';
import type { KarnatakaCauseListOptions } from './parse-cause-list-html.ts';

/** The most words one column name spans (`Advocate for the Petitioner`). */
const MAX_HEADER_WORDS = 6;
const MAX_LINE_LENGTH = 4000;
const DEFAULT_COLUMNS: readonly KarnatakaHcColumn[] = ['itemNo', 'caseNo', 'parties'];
const SERIAL = /^\d{1,4}[A-Z]?[.)]?$/;
const CELL_SEPARATOR = /\t+| {2,}/;

const REFERENCE =
  /^[A-Za-z][A-Za-z.()\s]*?\s*(?:\bNos?\b\.?\s*)?\d{1,7}\s*(?:\bof\b|\/)\s*(?:\d{4}|\d{2})\b(?:\s*\([A-Za-z0-9][A-Za-z0-9 .&/-]*?\))?/i;
const NEXT_REFERENCE =
  /^\s*(?:,|&|\band\b|\bin\b)\s*[A-Za-z][A-Za-z.()\s]*?\s*(?:\bNos?\b\.?\s*)?\d{1,7}\s*(?:\bof\b|\/)\s*(?:\d{4}|\d{2})\b(?:\s*\([A-Za-z0-9][A-Za-z0-9 .&/-]*?\))?/i;

/** The columns a header line names, in order, or null when the line is not a header. */
function headerColumns(line: string): KarnatakaHcColumn[] | null {
  const words = line.split(/\s+/).filter((word) => word !== '');
  const columns: KarnatakaHcColumn[] = [];
  let index = 0;
  while (index < words.length) {
    let end = -1;
    let column: KarnatakaHcColumn | null = null;
    for (let to = Math.min(words.length, index + MAX_HEADER_WORDS); to > index; to -= 1) {
      column = karnatakaHcColumnOf(words.slice(index, to).join(' '));
      if (column !== null) {
        end = to;
        break;
      }
    }
    if (column === null) return null;
    columns.push(column);
    index = end;
  }
  return columns.length >= 2 && columns.includes('caseNo') ? columns : null;
}

/** Splits `rest` (a row without its serial) into case text and parties, or null. */
function splitFlattened(rest: string): { caseNo: string; parties: string } | null {
  const first = REFERENCE.exec(rest);
  if (first === null) return null;
  let end = first[0].length;
  for (;;) {
    const next = NEXT_REFERENCE.exec(rest.slice(end));
    if (next === null) break;
    end += next[0].length;
  }
  return { caseNo: rest.slice(0, end).trim(), parties: rest.slice(end).trim() };
}

function eventsOf(pages: readonly string[], isListLine: (text: string) => boolean): ListEvent[] {
  const events: ListEvent[] = [];
  let columns: KarnatakaHcColumn[] | null = null;
  let sawRow = false;
  for (const [pageIndex, pageText] of pages.entries()) {
    const page = pageIndex + 1;
    for (const raw of pageText.split(/\r?\n/)) {
      const quote = raw.trim().slice(0, MAX_LINE_LENGTH);
      if (quote === '') continue;
      const header = headerColumns(quote);
      if (header !== null) {
        columns = header;
        sawRow = false;
        events.push({ kind: 'header', page });
        continue;
      }
      const asLine = () => {
        sawRow = false;
        events.push({ kind: 'line', page, text: quote });
      };
      const layout = columns ?? DEFAULT_COLUMNS;
      const indented = /^(?:\t| {2})/.test(raw) && raw.trim() !== '';
      const cells = quote.split(CELL_SEPARATOR).map((cell) => cell.trim());
      const serialLed = !indented && SERIAL.test(quote.split(/\s/, 1)[0] ?? '');
      if (indented && columns !== null && sawRow) {
        // Each leading tab is a blank cell; without tabs the text is taken as parties.
        const tabs = raw.match(/^\t*/)?.[0].length ?? 0;
        const target = tabs > 0 ? tabs : Math.max(1, layout.indexOf('parties'));
        const values: Partial<Record<KarnatakaHcColumn, string>> = {};
        for (const [offset, cell] of cells.entries()) {
          const column = layout[target + offset];
          if (column !== undefined && column !== 'itemNo') values[column] = cell;
        }
        events.push({ kind: 'cells', page, quote, cells: { itemNo: '', ...values } });
        continue;
      }
      if (!serialLed || (cells.length < 2 && isListLine(quote) && !splitFlattened(quote))) {
        asLine();
        continue;
      }
      const values: Partial<Record<KarnatakaHcColumn, string>> = {};
      if (cells.length >= 2 && (columns !== null || raw.includes('\t') || cells.length >= 3)) {
        for (const [index, cell] of cells.entries()) {
          const column = layout[index];
          if (column !== undefined) values[column] = cell;
        }
      } else {
        const space = quote.search(/\s/);
        const split = space < 0 ? null : splitFlattened(quote.slice(space).trim());
        if (split === null) {
          asLine();
          continue;
        }
        values.itemNo = quote.slice(0, space);
        values.caseNo = split.caseNo;
        values.parties = split.parties;
      }
      sawRow = true;
      events.push({ kind: 'cells', page, quote, cells: values });
    }
  }
  return events;
}

/** Parses the text of a contributed Karnataka HC cause list. */
export function parseKarnatakaCauseListText(
  input: ParserInput,
  { config, version }: KarnatakaCauseListOptions,
): ParsedCauseList {
  const pages = (input.text ?? '').split('\f');
  const readerPages: ListReaderPage[] = pages.map((text, index) => ({
    page: index + 1,
    text,
    readable: text.trim() !== '',
  }));
  const isListLine = (text: string) => isKarnatakaListLine(text, config);
  return readKarnatakaList(readerPages, eventsOf(pages, isListLine), {
    config,
    version,
    forumCode: input.meta.forumCode,
    source: 'text',
    fileName: input.meta.fileName,
  });
}
