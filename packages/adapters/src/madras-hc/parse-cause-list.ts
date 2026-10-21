// Madras HC cause-list parser (#396, part 2 of #36). Reads the text of a list the lawyer supplied
// (text, layout pages of a PDF, or HTML) line by line in the grammar of `config/list-grammar.ts`,
// assumed from parent #36 because research could not open a real list:
//
//   HIGH COURT OF JUDICATURE AT MADRAS            -> preamble (before the first hall: not headings)
//   DAILY CAUSE LIST FOR 23.10.2026               -> list type marker and list date
//   COURT No. 12                                  -> hall
//   THE HONOURABLE MR. JUSTICE A. FICTIONAL       -> bench (consecutive lines: division bench)
//   FOR ADMISSION                                 -> heading (open enum, `stageMap`)
//   1. W.P.No.12345 of 2026 and W.M.P.Nos.1 & 2 of 2026
//      Fictional Mills Ltd. vs The Secretary      -> parties (indented, or containing `vs`)
//      Mr. R. Fictional (MS/123/1990)             -> advocates (`/` or `;` between them)
//
// Table rows (cells split by tabs, as `layoutFromHtml` writes them, or by ` | `) read as item,
// case, parties, advocates unless the caller passes other columns. A page's leading lines that
// repeat page 1's preamble and `Page n of m` lines are skipped, so a row split across pages
// continues. Inside case numbers OCR confusions (`l`/`I` for 1, `O`/`o` for 0) and missing spaces
// are repaired at lower confidence; a row whose case number still cannot be read is returned in
// `unparsedRows` with its anchor. Every row quotes its first line verbatim. Pure and total: no clock,
// randomness or I/O, never throws.
import type { AdapterConfig } from '../config/schema.ts';
import { layoutFromHtml } from '../layout/html.ts';
import { normaliseDate } from '../normalise/date.ts';
import { matchKey } from '../normalise/match-key.ts';
import { normaliseStage } from '../normalise/stage.ts';
import type {
  Anchor,
  Advocate,
  CauseListHall,
  ListAttachment,
  ParsedCauseList,
  ParsedListRow,
  ParserInput,
  UnparsedRow,
} from '../types.ts';

import { parseAdvocate } from './advocates.ts';
import { parseCaseLine } from './case-line.ts';
import { MADRAS_HC_ADAPTER_ID } from './config/adapter-config.ts';
import type { EmailColumn } from './config/email-profiles.ts';
import { DEFAULT_EMAIL_COLUMNS } from './config/email-profiles.ts';
import {
  ADVOCATE_LINE,
  ADVOCATE_PERSON,
  BENCH_LINE,
  HALL_PROBE,
  LIST_DATE,
  LIST_TYPE_MARKERS,
  NO_CASES,
  PAGE_MARKER,
  PARTIES_SEPARATOR,
} from './config/list-grammar.ts';

/** One page of a list: its text and, for PDF layouts, its line items with boxes. */
export interface ListPage {
  page: number;
  text: string;
  items: readonly { text: string; bbox: { x: number; y: number; width: number; height: number } }[];
  /** Read only lines `from` (inclusive) to `to` (exclusive) of the page; default all. */
  from?: number;
  to?: number;
}

export interface ListLinesOptions {
  config: AdapterConfig;
  version: string;
  forumCode: string;
  source: NonNullable<ParsedCauseList['source']>;
  /** Table cell meanings (default item, case, parties, advocates). */
  columns?: readonly EmailColumn[];
  /** A list date read elsewhere (an email subject) and its anchor; the text is not searched then. */
  listDate?: { date: string; anchor: Anchor } | null;
  attachments?: readonly ListAttachment[];
}

export interface MadrasCauseListOptions {
  config: AdapterConfig;
  version: string;
}

const ITEM_CELL = /^(\d{1,4}[A-Z]?|\d{1,4}\([a-z]\))\.?$/;
const CASE_CONTINUATION = /^(?:and|in|with|&)\b.*\d/i;
const round = (value: number) => Math.round(value * 100) / 100;

interface Grammar {
  hall: RegExp;
  hallProbe: RegExp;
  row: RegExp;
  bench: RegExp;
  listDate: RegExp;
  noCases: RegExp;
  parties: RegExp;
  advocate: RegExp;
  person: RegExp;
  pageMarker: RegExp;
  markers: { regex: RegExp; key: string }[];
}

function grammarOf(config: AdapterConfig): Grammar {
  return {
    hall: new RegExp(config.listing.hallHeading ?? '(?!)', 'i'),
    hallProbe: new RegExp(HALL_PROBE, 'i'),
    row: new RegExp(config.listing.rowPattern ?? '(?!)'),
    bench: new RegExp(BENCH_LINE, 'i'),
    listDate: new RegExp(LIST_DATE, 'i'),
    noCases: new RegExp(NO_CASES, 'i'),
    parties: new RegExp(PARTIES_SEPARATOR, 'i'),
    advocate: new RegExp(ADVOCATE_LINE),
    person: new RegExp(ADVOCATE_PERSON),
    pageMarker: new RegExp(PAGE_MARKER, 'i'),
    markers: LIST_TYPE_MARKERS.map(({ pattern, key }) => ({
      regex: new RegExp(pattern, 'i'),
      key,
    })),
  };
}

/**
 * Repairs OCR noise inside case numbers: `l`/`I` read for 1 and `O`/`o` for 0 in numeric tokens, a
 * missing space before `No.` and around `of`. Returns the text unchanged when nothing applied.
 */
export function repairCaseText(text: string): string {
  return text
    .replace(/(?<=[A-Za-z])(?=Nos?\.)/g, ' ')
    .replace(/(?<=\d)of(?=\d)/gi, ' of ')
    .replace(/(?<![A-Za-z])(?=[\dlIOo]*\d)[\dlIOo]{2,}(?![A-Za-z])/g, (token) =>
      token.replace(/[lI]/g, '1').replace(/[Oo]/g, '0'),
    );
}

/** Advocates as printed on one line or cell: separated by ` / ` or `;`. */
function advocatesOf(text: string): Advocate[] {
  return text
    .split(/\s+\/\s+|;/)
    .map((part) => part.trim())
    .filter((part) => /[A-Za-z]/.test(part))
    .map(parseAdvocate);
}

interface OpenRow {
  page: ListPage;
  quote: string;
  itemNo: string;
  caseText: string;
  parties: string[];
  advocates: Advocate[];
  hallNo: string | undefined;
  bench: string | undefined;
  stageRaw: string | null;
  stageNorm: string | null;
}

/** The text of an input's pages: layout pages, HTML through `layoutFromHtml`, or text by form feed. */
export function listPagesOf(input: ParserInput): ListPage[] {
  if (input.layout !== undefined) {
    return input.layout.pages.map(({ page, text, items }) => ({ page, text, items }));
  }
  if (input.kind === 'html' && input.html !== undefined) {
    return layoutFromHtml(input.html).pages.map(({ page, text }) => ({ page, text, items: [] }));
  }
  const text = input.text ?? '';
  return text
    .split('\f')
    .map((pageText, index) => ({ page: index + 1, text: pageText, items: [] }));
}

/** Parses list lines from `pages` (the shared core of the list and AIMS email parsers). */
export function parseListLines(
  pages: readonly ListPage[],
  options: ListLinesOptions,
): ParsedCauseList {
  const { config } = options;
  const g = grammarOf(config);
  const caseOptions = {
    aliases: config.nomenclature.caseTypes,
    seatSuffixes: config.nomenclature.seatSuffixes,
    pivot: config.twoDigitYearPivot,
  };
  const columns = options.columns ?? DEFAULT_EMAIL_COLUMNS;

  const rows: ParsedListRow[] = [];
  const unparsedRows: UnparsedRow[] = [];
  const unmappedHeadings: string[] = [];
  const unknownCaseTypes: string[] = [];
  const hallsSeen: string[] = [];
  const hallsUnreadable: string[] = [];
  const halls = new Map<string, CauseListHall>();
  let rowsSkippedNoAnchor = 0;
  let listDate = options.listDate?.date ?? null;
  let listDateAnchor = options.listDate?.anchor ?? null;
  let listType: string | null = null;
  let hallNo: string | undefined;
  let bench: string | undefined;
  let lastWasBench = false;
  let inPreamble = true;
  let stage: { stageRaw: string | null; stageNorm: string | null } = {
    stageRaw: null,
    stageNorm: null,
  };
  let open: OpenRow | null = null;
  const pageHeader = new Set<string>();

  // `Mr. V. Madeup` is an advocate even though ` V. ` reads like `v.`.
  const isPartiesLine = (line: string) => g.parties.test(` ${line} `) && !g.person.test(line);

  const anchorFor = (page: ListPage, quote: string, rowIndex: number): Anchor | null => {
    if (quote === '' || !page.text.includes(quote)) return null;
    const item = page.items.find((candidate) => candidate.text.trim() === quote);
    return item === undefined
      ? { page: page.page, quote, rowIndex }
      : { page: page.page, quote, rowIndex, bbox: item.bbox };
  };

  const hallEntry = (no: string): CauseListHall => {
    let hall = halls.get(no);
    if (hall === undefined) {
      hall = { hallNo: no, lists: [{ rows: [] }] };
      halls.set(no, hall);
      if (!hallsSeen.includes(no)) hallsSeen.push(no);
    }
    return hall;
  };

  const finish = (row: OpenRow): void => {
    const repaired = repairCaseText(row.caseText);
    const line = parseCaseLine(repaired, caseOptions);
    if (line.refs.length === 0) {
      const anchor = anchorFor(row.page, row.quote, unparsedRows.length);
      if (anchor === null) rowsSkippedNoAnchor += 1;
      else unparsedRows.push({ anchor, text: row.quote, reason: 'case_number_unparseable' });
      return;
    }
    const unknown = new Set(
      line.diagnostics.filter((d) => d.code === 'case_type_unknown').map((d) => d.raw),
    );
    for (const raw of unknown) if (!unknownCaseTypes.includes(raw)) unknownCaseTypes.push(raw);
    const parties = row.parties.join(' ').replace(/\s+/g, ' ').trim();
    for (const ref of line.refs) {
      const anchor = anchorFor(row.page, row.quote, rows.length);
      if (anchor === null) {
        rowsSkippedNoAnchor += 1;
        continue;
      }
      const isUnknown = unknown.has(ref.caseTypeRaw);
      const caseType = isUnknown ? null : ref.caseTypeCode;
      let confidence = 1;
      if (repaired !== row.caseText) confidence -= 0.2;
      if (isUnknown) confidence -= 0.3;
      if (row.stageNorm === null) confidence -= 0.1;
      const parsed: ParsedListRow = {
        anchor,
        confidence: round(Math.max(0, confidence)),
        ...(row.hallNo === undefined ? {} : { hallNo: row.hallNo }),
        itemNo: row.itemNo,
        caseTypeRaw: ref.caseTypeRaw,
        caseType,
        ...(ref.seatSuffix === undefined ? {} : { seatSuffix: ref.seatSuffix }),
        caseNumber: ref.number,
        caseYear: ref.year,
        matchKey: isUnknown
          ? null
          : matchKey({
              caseType,
              seatSuffix: ref.seatSuffix,
              caseNumber: ref.number,
              caseYear: ref.year,
            }),
        ...(parties === '' ? {} : { parties }),
        stageRaw: row.stageRaw,
        stageNorm: row.stageNorm,
        advocates: row.advocates,
        ...(ref.children === undefined || ref.children.length === 0
          ? {}
          : { children: ref.children }),
        ...(row.bench === undefined ? {} : { bench: row.bench }),
        ...((ref.seatSuffix ?? null) === null ? {} : { forumMismatch: true }),
      };
      rows.push(parsed);
      if (row.hallNo !== undefined) hallEntry(row.hallNo).lists.at(-1)?.rows.push(parsed);
    }
  };

  const flush = (): void => {
    if (open !== null) finish(open);
    open = null;
  };

  const tableRow = (page: ListPage, line: string, cells: string[]): boolean => {
    const value = (column: EmailColumn) => {
      const index = columns.indexOf(column);
      return index < 0 ? '' : (cells[index] ?? '').trim();
    };
    const item = ITEM_CELL.exec(value('item'));
    if (item === null) return false;
    const hallCell = /(\d{1,3}[A-Z]?)\s*$/.exec(value('hall'))?.[1];
    if (hallCell !== undefined) {
      hallNo = hallCell;
      hallEntry(hallCell);
    }
    const parties = value('parties');
    finish({
      page,
      quote: line,
      itemNo: item[1] ?? '',
      caseText: value('case'),
      parties: parties === '' ? [] : [parties],
      advocates: advocatesOf(value('advocates')),
      hallNo,
      bench: hallNo === undefined ? undefined : (halls.get(hallNo)?.bench ?? bench),
      stageRaw: stage.stageRaw,
      stageNorm: stage.stageNorm,
    });
    return true;
  };

  for (const [pageIndex, page] of pages.entries()) {
    const lines = page.text.split('\n').slice(page.from ?? 0, page.to);
    let atTop = true;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '' || g.pageMarker.test(line)) continue;
      if (pageIndex > 0 && atTop && pageHeader.has(line)) continue;
      atTop = false;

      // Continuation of the open row: indented, or naming parties or advocates.
      if (
        open !== null &&
        !g.hall.test(line) &&
        !g.row.test(line) &&
        !g.bench.test(line) &&
        (/^\s/.test(rawLine) || g.parties.test(line) || g.advocate.test(line))
      ) {
        const row: OpenRow = open;
        if (CASE_CONTINUATION.test(line)) row.caseText = `${row.caseText} ${line}`;
        else if (isPartiesLine(line)) row.parties.push(line);
        else row.advocates.push(...advocatesOf(line));
        continue;
      }
      flush();

      const cells = line.split(/\t|\s\|\s/);
      if (cells.length >= 3 && tableRow(page, line, cells)) {
        lastWasBench = false;
        continue;
      }
      // A table line that is not a row (a column header) is never a heading.
      if (cells.length >= 3) continue;

      const hall = g.hall.exec(line);
      if (hall !== null) {
        inPreamble = false;
        const next = hall[1] ?? line;
        // A hall heading repeated on the next page keeps the hall's bench and heading.
        if (next !== hallNo) stage = { stageRaw: null, stageNorm: null };
        hallNo = next;
        bench = hallEntry(next).bench;
        lastWasBench = false;
        continue;
      }
      if (g.hallProbe.test(line)) {
        inPreamble = false;
        if (!hallsUnreadable.includes(line)) hallsUnreadable.push(line);
        hallNo = undefined;
        bench = undefined;
        lastWasBench = false;
        stage = { stageRaw: null, stageNorm: null };
        continue;
      }
      if (g.bench.test(line)) {
        bench = lastWasBench && bench !== undefined ? `${bench} AND ${line}` : line;
        lastWasBench = true;
        if (hallNo !== undefined) hallEntry(hallNo).bench = bench;
        continue;
      }
      lastWasBench = false;

      const row = g.row.exec(line);
      if (row !== null) {
        const rest = row[2] ?? '';
        const [caseText = '', ...tail] = rest.split(/\s{2,}/);
        const sameLine = tail.join(' ').trim();
        open = {
          page,
          quote: line,
          itemNo: row[1] ?? '',
          caseText,
          parties: sameLine !== '' && isPartiesLine(sameLine) ? [sameLine] : [],
          advocates: sameLine !== '' && !isPartiesLine(sameLine) ? advocatesOf(sameLine) : [],
          hallNo,
          bench,
          stageRaw: stage.stageRaw,
          stageNorm: stage.stageNorm,
        };
        continue;
      }

      const marker = g.markers.find(({ regex }) => regex.test(line));
      const isDateLine = g.listDate.test(line);
      if (marker !== undefined || isDateLine) {
        if (inPreamble && pageIndex === 0) pageHeader.add(line);
        listType ??= marker?.key ?? null;
        if (isDateLine && listDate === null) {
          const date = normaliseDate(line, { pivot: config.twoDigitYearPivot });
          if (date !== null) {
            listDate = date;
            listDateAnchor = anchorFor(page, line, 0);
          }
        }
        if (marker !== undefined && !inPreamble) {
          const mapped = normaliseStage(line, config.stageMap);
          if (mapped.stageNorm !== null) stage = mapped;
          if (hallNo !== undefined) {
            const entry = hallEntry(hallNo);
            if (entry.lists.at(-1)?.rows.length !== 0) entry.lists.push({ rows: [] });
          }
        }
        continue;
      }
      if (g.noCases.test(line)) continue;
      if (inPreamble) {
        if (pageIndex === 0) pageHeader.add(line);
        continue;
      }
      stage = normaliseStage(line, config.stageMap);
      if (stage.stageNorm === null && !unmappedHeadings.includes(line)) unmappedHeadings.push(line);
    }
  }
  flush();

  const readable = pages.some((page) => page.text.trim() !== '');
  return {
    adapterId: MADRAS_HC_ADAPTER_ID,
    adapterVersion: options.version,
    forumCode: options.forumCode,
    listDate,
    listType,
    source: options.source,
    status: rows.length + unparsedRows.length > 0 ? 'ok' : readable ? 'empty' : 'failed',
    halls: [...halls.values()].map((hall) => ({
      ...hall,
      lists: hall.lists.filter((list, index) => list.rows.length > 0 || index === 0),
    })),
    rows,
    unparsedRows,
    diagnostics: {
      unmappedHeadings,
      unknownCaseTypes,
      rowsSkippedNoAnchor,
      hallsSeen,
      hallsUnreadable,
    },
    listDateAnchor,
    ...(options.attachments === undefined ? {} : { attachments: [...options.attachments] }),
  };
}

const SOURCE_BY_KIND = {
  layout: 'pdf',
  html: 'html',
  text: 'text',
  email: 'email',
} as const satisfies Record<ParserInput['kind'], NonNullable<ParsedCauseList['source']>>;

/** Parses a supplied Madras HC cause list (text, PDF layout or HTML). */
export function parseMadrasCauseList(
  input: ParserInput,
  { config, version }: MadrasCauseListOptions,
): ParsedCauseList {
  const pages = listPagesOf(input).map((page) => ({
    ...page,
    text: page.text.replaceAll(/\r\n?/g, '\n'),
  }));
  return parseListLines(pages, {
    config,
    version,
    forumCode: input.meta.forumCode,
    source: SOURCE_BY_KIND[input.kind],
  });
}
