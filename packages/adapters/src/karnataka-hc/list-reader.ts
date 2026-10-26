// Karnataka HC cause-list reader (#405, part 2 of #37): the state machine both list parsers feed.
// The HTML parser (parse-cause-list-html.ts) and the PDF parser (parse-cause-list-pdf.ts) turn a
// supplied list into an ordered stream of events: a `line` of text outside the table, a column
// `header` row, or a table row's `cells`. This reads the assumed shape (ADR 0019):
//
//   HIGH COURT OF KARNATAKA / DAILY CAUSE LIST FOR 22-10-2026   -> preamble, list type and date
//   Last Causelist Updated on: 21-10-2026 06:30 PM               -> publishedAt (the evening before)
//   COURT HALL NO. 1                                             -> hall (repeats on later pages)
//   LIST NO. 2                                                   -> a separate list of the hall
//   HON'BLE MR. JUSTICE A. FICTIONAL                             -> bench (consecutive: joined)
//   PRELIMINARY HEARING                                          -> stage heading (open enum)
//   Sl. No. | Case No. | Petitioner / Respondent | Advocate for Petitioner | Advocate for Respondent
//   1 | WP No. 12345/2026 (GM-RES) | ... | ... | ...             -> row; an empty Sl. No. continues
//
// Rows under the `orders` heading (registry objections) carry `registryObjection: true`. A row whose
// case number cannot be read is returned in `unparsedRows` with its anchor; every anchor quote is
// verified against the page text. Status: `ok` with any row, `empty` when the list prints that
// nothing is listed, `failed` for a list (or an unreadable document) with no rows, and
// `not_a_cause_list` for a readable document with nothing of a list in it. Pure and total: no
// clock, randomness or I/O, never throws.
import type { AdapterConfig } from '../config/schema.ts';
import { normaliseDate } from '../normalise/date.ts';
import { matchKey } from '../normalise/match-key.ts';
import { normaliseStage } from '../normalise/stage.ts';
import type {
  Anchor,
  BBox,
  CauseListHall,
  ParsedCauseList,
  ParsedListRow,
  UnparsedRow,
} from '../types.ts';

import { parseKarnatakaAdvocates } from './advocate-keys.ts';
import { parseKarnatakaCaseLine } from './case-line.ts';
import type { KarnatakaHcColumn } from './config/column-synonyms.ts';
import {
  KARNATAKA_HC_BENCH_LINE,
  KARNATAKA_HC_LIST_DATE,
  KARNATAKA_HC_LIST_NO,
  KARNATAKA_HC_LIST_TITLE,
  KARNATAKA_HC_LIST_TYPE_MARKERS,
  KARNATAKA_HC_NO_CASES,
  KARNATAKA_HC_PAGE_MARKER,
  KARNATAKA_HC_PUBLISHED_STAMP,
  KARNATAKA_HC_STAMP_TIME,
} from './config/list-grammar.ts';

/** The adapter id (`KARNATAKA_HC_ADAPTER_ID`; index.ts imports this module, so not from there). */
const ADAPTER_ID = 'in.ka.karnataka-hc.bengaluru';

/** A line of text outside the table (title, hall, list, judge, heading). */
export interface ListLineEvent {
  kind: 'line';
  page: number;
  text: string;
  bbox?: BBox | undefined;
}

/** A table header row: the document is laid out as a list. */
export interface ListHeaderEvent {
  kind: 'header';
  page: number;
}

/** A table row: cell text by column (a column the table lacks is absent). */
export interface ListCellsEvent {
  kind: 'cells';
  page: number;
  /** Verbatim text of the row in the page text, the anchor quote. */
  quote: string;
  bbox?: BBox | undefined;
  cells: Partial<Record<KarnatakaHcColumn, string>>;
  /** The case-number link's text (HTML), read as the case number when present. */
  caseNoAnchorText?: string | undefined;
}

export type ListEvent = ListLineEvent | ListHeaderEvent | ListCellsEvent;

/** A page's reading-order text, which anchor quotes must occur in. */
export interface ListReaderPage {
  page: number;
  text: string;
  /** False for a page without a text layer (a scan). */
  readable: boolean;
}

export interface ListReaderOptions {
  config: AdapterConfig;
  version: string;
  forumCode: string;
  source: NonNullable<ParsedCauseList['source']>;
  /** The supplied file's name: a list-type marker in it is used when the text has none. */
  fileName?: string | undefined;
}

const SERIAL = /^(\d{1,4}[A-Z]?)[.)]?$/;
const IST_OFFSET = '+05:30';
const round = (value: number) => Math.round(value * 100) / 100;
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

interface Grammar {
  hall: RegExp;
  listNo: RegExp;
  bench: RegExp;
  listDate: RegExp;
  stamp: RegExp;
  stampTime: RegExp;
  noCases: RegExp;
  title: RegExp;
  pageMarker: RegExp;
  markers: { regex: RegExp; key: string }[];
}

const grammars = new WeakMap<AdapterConfig, Grammar>();

function grammarOf(config: AdapterConfig): Grammar {
  let grammar = grammars.get(config);
  if (grammar === undefined) {
    grammar = compileGrammar(config);
    grammars.set(config, grammar);
  }
  return grammar;
}

const compileGrammar = (config: AdapterConfig): Grammar => ({
  hall: new RegExp(config.listing.hallHeading ?? '(?!)', 'i'),
  listNo: new RegExp(KARNATAKA_HC_LIST_NO, 'i'),
  bench: new RegExp(KARNATAKA_HC_BENCH_LINE, 'i'),
  listDate: new RegExp(KARNATAKA_HC_LIST_DATE, 'i'),
  stamp: new RegExp(KARNATAKA_HC_PUBLISHED_STAMP, 'i'),
  stampTime: new RegExp(KARNATAKA_HC_STAMP_TIME, 'i'),
  noCases: new RegExp(KARNATAKA_HC_NO_CASES, 'i'),
  title: new RegExp(KARNATAKA_HC_LIST_TITLE, 'i'),
  pageMarker: new RegExp(KARNATAKA_HC_PAGE_MARKER, 'i'),
  markers: KARNATAKA_HC_LIST_TYPE_MARKERS.map(({ pattern, key }) => ({
    regex: new RegExp(pattern, 'i'),
    key,
  })),
});

/** The list-type key a heading or file name names, or null. */
export function karnatakaListTypeOf(text: string): string | null {
  for (const { pattern, key } of KARNATAKA_HC_LIST_TYPE_MARKERS) {
    // File names use `_` and `-` between words, which `\b` treats as word characters.
    if (new RegExp(pattern, 'i').test(text.replace(/[_-]+/g, ' '))) return key;
  }
  return null;
}

/**
 * The "Last Causelist Updated" stamp as an ISO timestamp in India Standard Time (fixed +05:30, no
 * daylight saving), or null when the line holds no readable date.
 */
export function karnatakaPublishedAt(line: string, pivot = 50): string | null {
  const date = normaliseDate(line, { pivot });
  if (date === null) return null;
  const time = new RegExp(KARNATAKA_HC_STAMP_TIME, 'i').exec(line);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (time !== null) {
    hours = Number(time[1]);
    minutes = Number(time[2]);
    seconds = Number(time[3] ?? '0');
    const meridiem = time[4]?.toUpperCase();
    if (meridiem !== undefined) {
      if (hours < 1 || hours > 12) return `${date}T00:00:00${IST_OFFSET}`;
      hours = (hours % 12) + (meridiem === 'P' ? 12 : 0);
    }
    if (hours > 23 || minutes > 59 || seconds > 59) hours = minutes = seconds = 0;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}${IST_OFFSET}`;
}

/**
 * Whether the reader treats `text` as a structural line (stamp, hall, list, judge, list title or
 * type, date, "no cases", page furniture) or a stage heading the stage map knows.
 */
export function isKarnatakaListLine(text: string, config: AdapterConfig): boolean {
  const g = grammarOf(config);
  const line = collapse(text);
  return (
    g.stamp.test(line) ||
    g.hall.test(line) ||
    g.listNo.test(line) ||
    g.bench.test(line) ||
    g.title.test(line) ||
    g.listDate.test(line) ||
    g.noCases.test(line) ||
    g.pageMarker.test(line) ||
    g.markers.some(({ regex }) => regex.test(line)) ||
    normaliseStage(line, config.stageMap).stageNorm !== null
  );
}

interface OpenRow {
  page: number;
  quote: string;
  bbox: BBox | undefined;
  itemNo: string;
  caseText: string;
  caseNoAnchorText: string | undefined;
  parties: string[];
  advocateCells: string[] | undefined;
  hallNo: string | undefined;
  bench: string | undefined;
  listNo: string | undefined;
  listType: string | null;
  stageRaw: string | null;
  stageNorm: string | null;
}

/** Reads the events of one supplied Karnataka HC list into a `ParsedCauseList`. */
export function readKarnatakaList(
  pages: readonly ListReaderPage[],
  events: Iterable<ListEvent>,
  options: ListReaderOptions,
): ParsedCauseList {
  const { config } = options;
  const g = grammarOf(config);
  const pivot = config.twoDigitYearPivot;
  const pageText = new Map(pages.map((page) => [page.page, page.text]));

  const rows: ParsedListRow[] = [];
  const unparsedRows: UnparsedRow[] = [];
  const unmappedHeadings: string[] = [];
  const unknownCaseTypes: string[] = [];
  const hallsSeen: string[] = [];
  const halls = new Map<string, CauseListHall>();
  let rowsSkippedNoAnchor = 0;
  let listDate: string | null = null;
  let listDateAnchor: Anchor | null = null;
  let publishedAt: string | null = null;
  // Set inside the event handlers, so held in an object TypeScript does not narrow.
  const doc = { listType: null as string | null, listSignal: false, noCases: false };
  let currentListType: string | null = null;
  let hallNo: string | undefined;
  let listNo: string | undefined;
  let bench: string | undefined;
  let lastWasBench = false;
  let inPreamble = true;
  let stage: { stageRaw: string | null; stageNorm: string | null } = {
    stageRaw: null,
    stageNorm: null,
  };
  let open: OpenRow | null = null;

  const anchorFor = (
    page: number,
    quote: string,
    rowIndex: number,
    bbox: BBox | undefined,
  ): Anchor | null => {
    if (quote === '' || !(pageText.get(page) ?? '').includes(quote)) return null;
    return bbox === undefined ? { page, quote, rowIndex } : { page, quote, rowIndex, bbox };
  };

  const hallEntry = (no: string): CauseListHall => {
    let hall = halls.get(no);
    if (hall === undefined) {
      hall = { hallNo: no, lists: [{ rows: [] }] };
      halls.set(no, hall);
      hallsSeen.push(no);
    }
    return hall;
  };

  /** The hall's list the next rows go into (`LIST NO. n`, or the hall's first list). */
  const currentList = (hall: CauseListHall): CauseListHall['lists'][number] => {
    const found = hall.lists.find((list) => list.listNo === listNo);
    if (found !== undefined) return found;
    const first = hall.lists[0];
    if (first !== undefined && first.listNo === undefined && first.rows.length === 0) {
      if (listNo !== undefined) first.listNo = listNo;
      return first;
    }
    const list = listNo === undefined ? { rows: [] } : { listNo, rows: [] };
    hall.lists.push(list);
    return list;
  };

  const finish = (row: OpenRow): void => {
    const caseText = collapse(row.caseNoAnchorText ?? row.caseText);
    const line = parseKarnatakaCaseLine(caseText, {
      pivot,
      aliases: config.nomenclature.caseTypes,
    });
    if (line.refs.length === 0) {
      const anchor = anchorFor(row.page, row.quote, unparsedRows.length, row.bbox);
      if (anchor === null) rowsSkippedNoAnchor += 1;
      else unparsedRows.push({ anchor, text: row.quote, reason: 'case_number_unparseable' });
      return;
    }
    const unknown = new Set(line.diagnostics.map((d) => d.raw));
    for (const raw of unknown) if (!unknownCaseTypes.includes(raw)) unknownCaseTypes.push(raw);
    const parties = collapse(row.parties.join(' '));
    const { advocates } = parseKarnatakaAdvocates(row.advocateCells);
    for (const ref of line.refs) {
      const anchor = anchorFor(row.page, row.quote, rows.length, row.bbox);
      if (anchor === null) {
        rowsSkippedNoAnchor += 1;
        continue;
      }
      const isUnknown = unknown.has(ref.caseTypeRaw);
      const caseType = isUnknown ? null : ref.caseTypeCode;
      let confidence = 1;
      if (isUnknown) confidence -= 0.3;
      if (row.stageNorm === null) confidence -= 0.1;
      const parsed: ParsedListRow = {
        anchor,
        confidence: round(Math.max(0, confidence)),
        ...(row.hallNo === undefined ? {} : { hallNo: row.hallNo }),
        ...(row.itemNo === '' ? {} : { itemNo: row.itemNo }),
        caseTypeRaw: ref.caseTypeRaw,
        caseType,
        caseNumber: ref.number,
        caseYear: ref.year,
        matchKey: isUnknown
          ? null
          : matchKey({ caseType, caseNumber: ref.number, caseYear: ref.year }),
        ...(parties === '' ? {} : { parties }),
        stageRaw: row.stageRaw,
        stageNorm: row.stageNorm,
        advocates,
        ...(ref.children === undefined || ref.children.length === 0
          ? {}
          : { children: ref.children }),
        ...(row.bench === undefined ? {} : { bench: row.bench }),
        ...(row.listNo === undefined ? {} : { listNo: row.listNo }),
        listType: row.listType,
        registryObjection: row.stageNorm === 'orders' ? true : null,
        ...(ref.subCategory === undefined ? {} : { subCategory: ref.subCategory }),
        ...(ref.benchNumbering === undefined ? {} : { benchNumbering: ref.benchNumbering }),
      };
      rows.push(parsed);
      if (row.hallNo !== undefined) currentList(hallEntry(row.hallNo)).rows.push(parsed);
    }
  };

  const flush = (): void => {
    if (open !== null) finish(open);
    open = null;
  };

  const onCells = (event: ListCellsEvent): void => {
    const { cells } = event;
    const item = collapse(cells.itemNo ?? '');
    const hasAdvocateColumns =
      cells.petitionerAdvocate !== undefined || cells.respondentAdvocate !== undefined;
    const advocateCells = [cells.petitionerAdvocate, cells.respondentAdvocate]
      .map((cell) => collapse(cell ?? ''))
      .filter((cell) => cell !== '');
    if (item === '' && open !== null) {
      // A continuation line of the open row: wrapped case, parties or advocates.
      const row: OpenRow = open;
      const caseText = collapse(cells.caseNo ?? '');
      if (caseText !== '') row.caseText = `${row.caseText} ${caseText}`;
      const parties = collapse(cells.parties ?? '');
      if (parties !== '') row.parties.push(parties);
      if (row.advocateCells !== undefined) row.advocateCells.push(...advocateCells);
      return;
    }
    flush();
    if (item === '') return;
    inPreamble = false;
    lastWasBench = false;
    const serial = SERIAL.exec(item);
    const caseNoAnchorText = collapse(event.caseNoAnchorText ?? '');
    open = {
      page: event.page,
      quote: event.quote,
      bbox: event.bbox,
      itemNo: serial?.[1] ?? item,
      caseText: collapse(cells.caseNo ?? ''),
      caseNoAnchorText: caseNoAnchorText === '' ? undefined : caseNoAnchorText,
      parties: cells.parties === undefined || collapse(cells.parties) === '' ? [] : [cells.parties],
      advocateCells: hasAdvocateColumns ? advocateCells : undefined,
      hallNo,
      bench: hallNo === undefined ? bench : (halls.get(hallNo)?.bench ?? bench),
      listNo,
      listType: currentListType,
      stageRaw: stage.stageRaw,
      stageNorm: stage.stageNorm,
    };
  };

  const onLine = (event: ListLineEvent): void => {
    const line = collapse(event.text);
    if (line === '' || g.pageMarker.test(line)) return;
    flush();

    if (g.stamp.test(line)) {
      doc.listSignal = true;
      publishedAt ??= karnatakaPublishedAt(line, pivot);
      lastWasBench = false;
      return;
    }
    const hall = g.hall.exec(line);
    if (hall !== null) {
      doc.listSignal = true;
      inPreamble = false;
      const next = hall[1] ?? line;
      // A hall repeated on a later page keeps its list, bench and heading.
      if (next !== hallNo) {
        stage = { stageRaw: null, stageNorm: null };
        listNo = undefined;
      }
      hallNo = next;
      bench = hallEntry(next).bench;
      lastWasBench = false;
      return;
    }
    const list = g.listNo.exec(line);
    if (list !== null) {
      doc.listSignal = true;
      inPreamble = false;
      const next = list[1] ?? line;
      if (next !== listNo) stage = { stageRaw: null, stageNorm: null };
      listNo = next;
      if (hallNo !== undefined) currentList(hallEntry(hallNo));
      const marker = karnatakaListTypeOf(line);
      if (marker !== null) {
        currentListType = marker;
        doc.listType ??= marker;
      }
      lastWasBench = false;
      return;
    }
    if (g.bench.test(line)) {
      bench = lastWasBench && bench !== undefined ? `${bench} AND ${line}` : line;
      lastWasBench = true;
      if (hallNo !== undefined) hallEntry(hallNo).bench = bench;
      return;
    }
    lastWasBench = false;

    if (g.noCases.test(line)) {
      doc.noCases = true;
      return;
    }

    const marker = g.markers.find(({ regex }) => regex.test(line));
    const isTitle = g.title.test(line);
    const isDateLine = g.listDate.test(line);
    if (marker !== undefined || isTitle || isDateLine) {
      if (isTitle) doc.listSignal = true;
      if (marker !== undefined) {
        currentListType = marker.key;
        doc.listType ??= marker.key;
      }
      if (isDateLine && listDate === null) {
        const date = normaliseDate(line, { pivot });
        if (date !== null) {
          listDate = date;
          listDateAnchor = anchorFor(event.page, line, 0, event.bbox);
        }
      }
      return;
    }
    if (inPreamble) return;
    stage = normaliseStage(line, config.stageMap);
    if (stage.stageNorm === null && !unmappedHeadings.includes(line)) unmappedHeadings.push(line);
  };

  for (const event of events) {
    if (event.kind === 'line') onLine(event);
    else if (event.kind === 'header') {
      // A header repeated on the next page does not close a row split across the break.
      doc.listSignal = true;
      inPreamble = false;
      lastWasBench = false;
    } else onCells(event);
  }
  flush();

  if (doc.listType === null && options.fileName !== undefined) {
    doc.listType = karnatakaListTypeOf(options.fileName);
  }
  const { listType } = doc;
  for (const row of rows) row.listType ??= listType;

  const readable = pages.some((page) => page.readable && page.text.trim() !== '');
  const found = rows.length + unparsedRows.length > 0;
  let status: NonNullable<ParsedCauseList['status']>;
  if (found) status = 'ok';
  else if (!readable) status = 'failed';
  else if (doc.noCases) status = 'empty';
  else if (doc.listSignal) status = 'failed';
  else status = 'not_a_cause_list';

  return {
    adapterId: ADAPTER_ID,
    adapterVersion: options.version,
    forumCode: options.forumCode,
    listDate,
    publishedAt,
    listType,
    source: options.source,
    status,
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
      hallsUnreadable: [],
    },
    listDateAnchor,
  };
}
