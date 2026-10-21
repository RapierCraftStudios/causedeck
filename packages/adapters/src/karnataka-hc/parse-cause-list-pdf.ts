// Karnataka HC cause list from the layout of a supplied PDF (#405, part 2 of #37). The caller reads
// the PDF with `layoutFromPdf`; this turns its lines and words into list-reader events. A line whose
// words spell column names (`karnatakaHcColumnOf`, several words per name) is the table header:
// each column starts at the x of its first header word. Later words fall in the column whose start
// is the nearest one at or left of the word, `COLUMN_TOLERANCE` points of x-jitter allowed. A row
// starts at a serial number in the first column; a line with an empty serial cell whose cells are
// left-aligned to their columns continues the row (wrapped parties, advocates or case text). Any
// other line (hall, list, judge, stage heading, title) is a line. A page without its own header
// keeps the previous page's columns, so a hall continues across pages. Anchors quote the layout
// line and carry its bbox. Linear in the words of a page; no I/O.
import type { BBox, LayoutDocument, ParsedCauseList, ParserInput } from '../types.ts';

import { karnatakaHcColumnOf, type KarnatakaHcColumn } from './config/column-synonyms.ts';
import {
  isKarnatakaListLine,
  readKarnatakaList,
  type ListEvent,
  type ListReaderPage,
} from './list-reader.ts';
import type { KarnatakaCauseListOptions } from './parse-cause-list-html.ts';

/** Points of x-jitter a word may have against its column's header position. */
export const COLUMN_TOLERANCE = 4;
/** The most words one column name spans (`Advocate for the Petitioner`). */
const MAX_HEADER_WORDS = 6;

type LayoutPage = LayoutDocument['pages'][number];

interface Word {
  text: string;
  bbox: BBox;
}

interface Line {
  text: string;
  bbox: BBox;
  words: Word[];
}

interface Column {
  column: KarnatakaHcColumn;
  x: number;
}

/** The page's lines with the words that sit on each (by vertical centre). */
function linesOf(page: LayoutPage): Line[] {
  const words = [...(page.words ?? [])].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const lines: Line[] = page.items.map((item) => ({ ...item, words: [] }));
  const byTop = [...lines.keys()].sort((a, b) => (lines[a]?.bbox.y ?? 0) - (lines[b]?.bbox.y ?? 0));
  let start = 0;
  for (const word of words) {
    const centre = word.bbox.y + word.bbox.height / 2;
    while (start < byTop.length) {
      const line = lines[byTop[start] ?? 0];
      if (line === undefined || line.bbox.y + line.bbox.height + 0.5 >= centre) break;
      start += 1;
    }
    for (let index = start; index < byTop.length; index += 1) {
      const line = lines[byTop[index] ?? 0];
      if (line === undefined || line.bbox.y - 0.5 > centre) break;
      if (centre <= line.bbox.y + line.bbox.height + 0.5) {
        line.words.push(word);
        break;
      }
    }
  }
  for (const line of lines) line.words.sort((a, b) => a.bbox.x - b.bbox.x);
  return lines;
}

/** The columns a header line names, or null when the line is not a header. */
function headerColumns(words: readonly Word[]): Column[] | null {
  const columns: Column[] = [];
  let index = 0;
  while (index < words.length) {
    let end = -1;
    let column: KarnatakaHcColumn | null = null;
    for (let to = Math.min(words.length, index + MAX_HEADER_WORDS); to > index; to -= 1) {
      column = karnatakaHcColumnOf(
        words
          .slice(index, to)
          .map((word) => word.text)
          .join(' '),
      );
      if (column !== null) {
        end = to;
        break;
      }
    }
    const first = words[index];
    if (column === null || first === undefined) return null;
    columns.push({ column, x: first.bbox.x });
    index = end;
  }
  return columns.length >= 2 && columns.some((c) => c.column === 'caseNo') ? columns : null;
}

/** The index of the column a word falls in, or -1 when it is left of the table. */
function columnIndex(columns: readonly Column[], x: number): number {
  let found = -1;
  for (const [index, column] of columns.entries()) {
    if (column.x <= x + COLUMN_TOLERANCE) found = index;
    else break;
  }
  return found;
}

function eventsOf(
  pages: readonly LayoutPage[],
  isListLine: (text: string) => boolean,
): ListEvent[] {
  const events: ListEvent[] = [];
  let columns: Column[] | null = null;
  for (const page of pages) {
    if (page.textCoverage === 0) continue;
    for (const line of linesOf(page)) {
      const text = line.text.trim();
      if (text === '') continue;
      const header = headerColumns(line.words);
      if (header !== null) {
        columns = header.sort((a, b) => a.x - b.x);
        events.push({ kind: 'header', page: page.page });
        continue;
      }
      const asLine = () => events.push({ kind: 'line', page: page.page, text, bbox: line.bbox });
      if (columns === null || line.words.length === 0) {
        asLine();
        continue;
      }
      const cells = new Map<number, Word[]>();
      let leftOfTable = false;
      for (const word of line.words) {
        const index = columnIndex(columns, word.bbox.x);
        if (index < 0) leftOfTable = true;
        else cells.set(index, [...(cells.get(index) ?? []), word]);
      }
      const itemIndex = columns.findIndex((c) => c.column === 'itemNo');
      const item = (cells.get(itemIndex) ?? []).map((word) => word.text).join(' ');
      const serial = /^\d{1,4}[A-Z]?[.)]?$/.test(item);
      const aligned = [...cells.entries()].every(([index, words]) => {
        const start = columns?.[index]?.x ?? 0;
        return Math.abs((words[0]?.bbox.x ?? start) - start) <= COLUMN_TOLERANCE;
      });
      // A serial number starts a row even when its parties read like a heading.
      if (!serial && (leftOfTable || item !== '' || !aligned || isListLine(text))) {
        asLine();
        continue;
      }
      const values: Partial<Record<KarnatakaHcColumn, string>> = {};
      for (const [index, column] of columns.entries()) {
        values[column.column] = (cells.get(index) ?? []).map((word) => word.text).join(' ');
      }
      events.push({ kind: 'cells', page: page.page, quote: text, bbox: line.bbox, cells: values });
    }
  }
  return events;
}

/** Parses the layout (`layoutFromPdf`) of a supplied Karnataka HC cause-list PDF. */
export function parseKarnatakaCauseListPdf(
  input: ParserInput,
  { config, version }: KarnatakaCauseListOptions,
): ParsedCauseList {
  const layoutPages = input.layout?.pages ?? [];
  const pages: ListReaderPage[] = layoutPages.map((page) => ({
    page: page.page,
    text: page.text,
    readable: page.textCoverage !== 0 && page.text.trim() !== '',
  }));
  const isListLine = (text: string) => isKarnatakaListLine(text, config);
  return readKarnatakaList(pages, eventsOf(layoutPages, isListLine), {
    config,
    version,
    forumCode: input.meta.forumCode,
    source: 'pdf',
    fileName: input.meta.fileName,
  });
}
