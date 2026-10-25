// NCLT Bengaluru cause-list parser (#38, ADR 0020). The list is one PDF per bench per date with a
// table (research/raw/09 §2.2): Sl. No., CP No., CA/IA No., Purpose, Section, Name of Parties,
// counsel for each side, IRP/RP/Liquidator/MP and Remarks, under a coram and hearing-mode preamble.
// `parseNcltCauseList` reads a `LayoutDocument` (the PDF text layer, or an OCR layout, #45):
// - a document without a text layer returns `status: needs_ocr` and no rows, never a guess;
// - preamble lines give the list date, coram (`bench`), hearing mode and time; a second coram
//   starts a new bench section. A video-conference link only sets `hasVcLink`: no URL is stored
//   and none is followed;
// - the header row is found by column names (table/cluster.ts) and repeats per page are skipped;
// - body lines become rows with nested IAs (table/rows.ts); each row is anchored on its first line,
//   quoted verbatim from the page text. Lines that fit no column, orphan continuation lines and
//   rows without a readable case number go to `unparsedRows`.
// Counsel stay raw strings with alias spellings (no transliteration). Pure and deterministic.
import { z } from 'zod';

import type { AdapterConfig } from '../config/schema.ts';
import { normaliseDate } from '../normalise/date.ts';
import {
  AdvocateSchema,
  AnchorSchema,
  type Advocate,
  type Anchor,
  type LayoutDocument,
} from '../types.ts';

import { parseNcltCaseNumber, parseNcltCaseNumbers, type NcltCaseNumber } from './case-number.ts';
import { childKindOf } from './config/prefixes.ts';
import {
  assignColumns,
  detectHeader,
  groupLines,
  unionBox,
  type Line,
  type TableConfig,
  type TableHeader,
  type Word,
} from './table/cluster.ts';
import { joinCell, RowAssembler, type RawRow, type RowLine } from './table/rows.ts';

export const NcltCaseNumberSchema = z.object({
  prefix: z.string().min(1),
  code: z.string().min(1),
  number: z.string().min(1),
  bench: z.string().nullable(),
  year: z.number().int(),
});

export const NcltChildSchema = z.object({
  kind: z.enum(['IA', 'CA', 'MA']),
  prefix: z.string().min(1),
  code: z.string().min(1),
  number: z.string().min(1),
  bench: z.string().nullable(),
  year: z.number().int(),
  purpose: z.string().optional(),
  section: z.string().optional(),
});
export type NcltChild = z.infer<typeof NcltChildSchema>;

export const NcltRowSchema = z.object({
  slNo: z.string().nullable(),
  cp: NcltCaseNumberSchema,
  children: z.array(NcltChildSchema),
  purpose: z.string().nullable(),
  section: z.string().nullable(),
  /** `Name of Parties` as printed (cell lines joined by spaces). */
  parties: z.string().nullable(),
  /** Split on the first `Vs` / `V/s` / `versus`; null when the cell has none. */
  petitioner: z.string().nullable(),
  respondent: z.string().nullable(),
  counselPetitioner: z.array(z.string()),
  counselRespondent: z.array(z.string()),
  advocates: z.array(AdvocateSchema),
  resolutionProfessional: z.string().optional(),
  remarks: z.string().optional(),
  /** The bench section (`benches[benchIndex]`) the row sits under. */
  benchIndex: z.number().int().nonnegative(),
  anchor: AnchorSchema,
});
export type NcltRow = z.infer<typeof NcltRowSchema>;

export const HEARING_MODES = ['physical', 'video_conference', 'hybrid'] as const;

export const NcltBenchSchema = z.object({
  /** The coram as printed, members joined by `; `; null when the list prints none. */
  bench: z.string().nullable(),
  hearingMode: z.enum(HEARING_MODES).nullable(),
  /** 24-hour `HH:MM`. */
  time: z.string().nullable(),
  /** The list prints a video-conference link. The link itself is never kept. */
  hasVcLink: z.boolean(),
});
export type NcltBench = z.infer<typeof NcltBenchSchema>;

export const NcltUnparsedRowSchema = z.object({
  reason: z.enum(['unassigned_words', 'no_row', 'no_case_number', 'no_anchor']),
  /** Null only when no part of the line is verbatim in the page text. */
  anchor: AnchorSchema.nullable(),
});
export type NcltUnparsedRow = z.infer<typeof NcltUnparsedRowSchema>;

export const NcltCauseListSchema = z.object({
  status: z.enum(['parsed', 'needs_ocr']),
  listDate: z.string().nullable(),
  /** The first bench section's coram and hearing mode. */
  bench: z.string().nullable(),
  hearingMode: z.enum(HEARING_MODES).nullable(),
  hasVcLink: z.boolean(),
  benches: z.array(NcltBenchSchema),
  rows: z.array(NcltRowSchema),
  unparsedRows: z.array(NcltUnparsedRowSchema),
  diagnostics: z.object({
    headerFound: z.boolean(),
    /** Canonical column keys the header lacks. */
    missingColumns: z.array(z.string()),
    /** Header text of columns the config does not know. */
    extraColumns: z.array(z.string()),
    /** Neither counsel column is printed, so no advocate can be read. */
    noCounselColumns: z.boolean(),
    /** Pages without a text layer, for OCR (#45). */
    pagesNeedingOcr: z.array(z.number().int()),
    /** Case-number prefixes the config does not list, as printed. */
    unknownPrefixes: z.array(z.string()),
  }),
});
export type NcltCauseList = z.infer<typeof NcltCauseListSchema>;

/** The table section of a config, with the defaults the schema applies. */
function tableConfig(config: AdapterConfig): TableConfig {
  const table = config.table;
  if (table === undefined) throw new Error('The NCLT parser needs a config with a `table` section');
  return {
    columns: table.columns,
    minHeaderMatches: table.minHeaderMatches,
    columnTolerancePx: table.columnTolerancePx,
  };
}

const URLS = /\b(?:https?:\/\/|www\.)\S+/gi;
const HAS_URL = /\b(?:https?:\/\/|www\.)\S+/i;
const PAGE_FOOTER = /^page\s+\d+(?:\s+of\s+\d+)?$/i;
const CORAM = /^coram\b\s*[:-]?\s*(.*)$/i;
const MEMBER = /^hon'?ble\b/i;
const METADATA_START =
  /^(?:coram\b|hon'?ble\b|physical\s+hearing|video\s+conferenc|hybrid\b|through\s+video|vc\s+link|webex|cause\s+list)/i;
const TIME = /\b(\d{1,2})[:.](\d{2})\s*([ap])\.?\s*m\b\.?/i;
const PARTIES_SPLIT = /\s+(?:vs\.?|v\/s\.?|versus)\s+/i;
const COUNSEL_SPLIT = /\s*[,;]\s*/;
const HONORIFIC = /^(?:MR|MRS|MS|DR|ADV|ADVOCATE|SR|SENIOR|SHRI|SMT|SRI|M\/S)$/;

/**
 * Deterministic alias spellings of a counsel name in the shared convention (`AdvocateSchema`):
 * upper case, titles stripped, initials split, never transliterated; plus the initials run
 * together. `Mr. K. S. Madeup` gives `K S MADEUP`, `MADEUP K S` and `KS MADEUP`.
 */
export function counselAliases(raw: string): string[] {
  const words = raw
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s.]+/)
    .filter((word) => word !== '' && !HONORIFIC.test(word));
  const initials = words.filter((word) => word.length === 1);
  const names = words.filter((word) => word.length > 1);
  const aliases = [[...initials, ...names].join(' '), [...names, ...initials].join(' ')];
  if (initials.length > 1) aliases.push([initials.join(''), ...names].join(' '));
  return [...new Set(aliases.filter((alias) => alias !== ''))];
}

function splitCounsel(text: string): string[] {
  return text
    .split(COUNSEL_SPLIT)
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

function time24(text: string): string | null {
  const match = TIME.exec(text);
  if (match === null) return null;
  let hour = Number(match[1]) % 12;
  if ((match[3] ?? '').toLowerCase() === 'p') hour += 12;
  return `${String(hour).padStart(2, '0')}:${match[2] ?? '00'}`;
}

function hearingModeOf(text: string): NcltBench['hearingMode'] {
  const physical = /physical/i.test(text);
  const video = /video\s+conferenc|\bvc\b|webex|virtual/i.test(text);
  if (/hybrid/i.test(text) || (physical && video)) return 'hybrid';
  if (physical) return 'physical';
  return video ? 'video_conference' : null;
}

const stripUrls = (text: string) => text.replace(URLS, '').replace(/\s+/g, ' ').trim();

/**
 * A verbatim quote for a line: the whole line, else its longest URL-free part, else a word, when
 * it is in the page text. A quote never contains a link.
 */
function quoteFor(pageText: string, line: Line): string | null {
  const parts = line.text
    .split(URLS)
    .map((part) => part.trim())
    .sort((a, b) => b.length - a.length);
  const words = line.words.map((word) => word.text);
  for (const candidate of [line.text, ...parts, ...words]) {
    if (candidate !== '' && !HAS_URL.test(candidate) && pageText.includes(candidate)) {
      return candidate;
    }
  }
  return null;
}

interface PageContext {
  page: number;
  text: string;
}

function anchorOf(
  context: PageContext,
  line: Line,
  rowIndex: number,
  words: Word[],
): Anchor | null {
  const quote = quoteFor(context.text, line);
  if (quote === null) return null;
  const bbox = unionBox(words);
  return bbox === undefined
    ? { page: context.page, quote, rowIndex }
    : { page: context.page, quote, rowIndex, bbox };
}

const yearOptions = (config: AdapterConfig) => ({
  pivot: config.twoDigitYearPivot,
  aliases: config.nomenclature.caseTypes,
});

/** Whether a body line opens a matter row: a readable matter number, or a serial with CP text. */
function opensRow(
  assigned: RowLine['assigned'],
  config: AdapterConfig,
  hasCpColumn: boolean,
): boolean {
  if (!hasCpColumn) return (assigned.cells.slNo ?? '') !== '';
  const cp = assigned.cells.cpNo ?? '';
  if (cp === '') return false;
  if ((assigned.cells.slNo ?? '') !== '') return true;
  const reference = parseNcltCaseNumber(cp, yearOptions(config));
  return reference !== null && childKindOf(reference.code) === null;
}

interface Built {
  row: Omit<NcltRow, 'anchor' | 'benchIndex'> | null;
  reason?: NcltUnparsedRow['reason'];
}

function toChild(reference: NcltCaseNumber): NcltChild | null {
  const kind = childKindOf(reference.code);
  return kind === null ? null : { kind, ...reference };
}

/** Folds a raw row's lines into a matter with its nested applications. */
function buildRow(raw: RawRow, config: AdapterConfig): Built {
  const options = yearOptions(config);
  const [first, ...rest] = raw.lines;
  if (first === undefined) return { row: null, reason: 'no_row' };
  const cp = parseNcltCaseNumber(joinCell(raw.lines, 'cpNo'), options);
  if (cp === null) return { row: null, reason: 'no_case_number' };

  const parent: Record<string, string[]> = {};
  const push = (key: string, text: string | undefined) => {
    const clean = stripUrls(text ?? '');
    if (clean !== '') (parent[key] ??= []).push(clean);
  };
  const children: NcltChild[] = [];
  const childrenOf = (text: string) =>
    parseNcltCaseNumbers(text, options).flatMap((reference) => toChild(reference) ?? []);

  for (const [key, text] of Object.entries(first.assigned.cells)) {
    if (key === 'caIaNo') children.push(...childrenOf(text));
    else push(key, text);
  }
  let target: NcltChild[] | null = null;
  for (const { assigned } of rest) {
    const { cells } = assigned;
    const found = childrenOf(cells.caIaNo ?? '');
    const purpose = stripUrls(cells.purpose ?? '');
    const section = stripUrls(cells.section ?? '');
    if (found.length > 0) {
      for (const child of found) {
        if (purpose !== '') child.purpose = purpose;
        if (section !== '') child.section = section;
      }
      children.push(...found);
      target = found;
    } else if (target !== null) {
      for (const child of target) {
        if (purpose !== '') child.purpose = [child.purpose, purpose].filter(Boolean).join(' ');
        if (section !== '') child.section = [child.section, section].filter(Boolean).join(' ');
      }
    } else {
      push('purpose', purpose);
      push('section', section);
    }
    for (const [key, text] of Object.entries(cells)) {
      if (key === 'caIaNo' || key === 'purpose' || key === 'section') continue;
      push(key, text);
    }
  }

  const cell = (key: string) => (parent[key] ?? []).join(' ');
  const orNull = (text: string) => (text === '' ? null : text);
  const parties = orNull(cell('parties'));
  const split = parties === null ? null : parties.split(PARTIES_SPLIT);
  const hasSplit = split !== null && split.length >= 2;
  const counselPetitioner = splitCounsel(cell('counselPetitioner'));
  const counselRespondent = splitCounsel(cell('counselRespondent'));
  const advocates: Advocate[] = [
    ...counselPetitioner.map((name) => ({
      raw: name,
      aliases: counselAliases(name),
      side: 'petitioner' as const,
    })),
    ...counselRespondent.map((name) => ({
      raw: name,
      aliases: counselAliases(name),
      side: 'respondent' as const,
    })),
  ];
  const resolutionProfessional = cell('resolutionProfessional');
  const remarks = cell('remarks');
  return {
    row: {
      slNo: orNull(joinCell([first], 'slNo')),
      cp,
      children,
      purpose: orNull(cell('purpose')),
      section: orNull(cell('section')),
      parties,
      petitioner: hasSplit ? (split[0] ?? '').trim() : null,
      respondent: hasSplit ? split.slice(1).join(' Vs ').trim() : null,
      counselPetitioner,
      counselRespondent,
      advocates,
      ...(resolutionProfessional === '' ? {} : { resolutionProfessional }),
      ...(remarks === '' ? {} : { remarks }),
    },
  };
}

const emptyBench = (): NcltBench => ({
  bench: null,
  hearingMode: null,
  time: null,
  hasVcLink: false,
});

/** Parses an NCLT Bengaluru cause list from its layout. */
export function parseNcltCauseList(layout: LayoutDocument, config: AdapterConfig): NcltCauseList {
  const table = tableConfig(config);
  const pagesNeedingOcr = layout.pages
    .filter((page) => page.textCoverage === 0 || (page.words ?? []).length === 0)
    .map((page) => page.page);
  const empty = {
    listDate: null,
    bench: null,
    hearingMode: null,
    hasVcLink: false,
    benches: [],
    rows: [],
    unparsedRows: [],
  };
  if (layout.pages.length === 0 || pagesNeedingOcr.length === layout.pages.length) {
    return {
      status: 'needs_ocr',
      ...empty,
      diagnostics: {
        headerFound: false,
        missingColumns: [],
        extraColumns: [],
        noCounselColumns: false,
        pagesNeedingOcr,
        unknownPrefixes: [],
      },
    };
  }

  const benches: NcltBench[] = [emptyBench()];
  const assembler = new RowAssembler();
  const unparsedLines: { context: PageContext; line: Line; reason: NcltUnparsedRow['reason'] }[] =
    [];
  const contexts = new Map<number, PageContext>();
  let header: TableHeader | null = null;
  let firstHeader: TableHeader | null = null;
  let listDate: string | null = null;
  let lastWasCoram = false;

  const benchIndex = () => benches.length - 1;
  const currentBench = (): NcltBench => {
    if (assembler.countIn(benchIndex()) > 0) benches.push(emptyBench());
    return benches[benchIndex()] as NcltBench;
  };
  const readMetadata = (text: string) => {
    if (HAS_URL.test(text)) currentBench().hasVcLink = true;
    const clean = stripUrls(text);
    listDate ??= /cause\s+list|dated?\b|date\s+of\s+hearing/i.test(clean)
      ? normaliseDate(clean, { pivot: config.twoDigitYearPivot })
      : null;
    const coram = CORAM.exec(clean);
    if (coram !== null || (MEMBER.test(clean) && !lastWasCoram)) {
      let bench = currentBench();
      if (bench.bench !== null) {
        benches.push(emptyBench());
        bench = benches[benchIndex()] as NcltBench;
      }
      const members = coram === null ? clean : (coram[1] ?? '').trim();
      bench.bench = members === '' ? null : members;
      lastWasCoram = true;
      return;
    }
    if (MEMBER.test(clean) && lastWasCoram) {
      const bench = benches[benchIndex()] as NcltBench;
      bench.bench = bench.bench === null ? clean : `${bench.bench}; ${clean}`;
      return;
    }
    lastWasCoram = false;
    const mode = hearingModeOf(clean);
    const time = time24(clean);
    if (mode === null && time === null) return;
    const bench = currentBench();
    if (mode !== null) {
      bench.hearingMode =
        bench.hearingMode === null || bench.hearingMode === mode ? mode : 'hybrid';
    }
    bench.time ??= time;
  };

  for (const page of layout.pages) {
    const context: PageContext = { page: page.page, text: page.text };
    contexts.set(page.page, context);
    const lines = groupLines(page.page, page.words ?? []);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as Line;
      const found = detectHeader(lines, index, table);
      if (found !== null) {
        header = found;
        firstHeader ??= found;
        index += found.lineCount - 1;
        lastWasCoram = false;
        continue;
      }
      if (PAGE_FOOTER.test(line.text)) continue;
      const startsLeft =
        header === null || line.words[0] === undefined
          ? true
          : line.words[0].bbox.x <
            (header.columns[1]?.x0 ?? Number.POSITIVE_INFINITY) - table.columnTolerancePx;
      if (header === null || (startsLeft && METADATA_START.test(line.text))) {
        readMetadata(line.text);
        continue;
      }
      lastWasCoram = false;
      const assigned = assignColumns(line, header, table.columnTolerancePx);
      if (assigned.unassigned.length > 0) {
        unparsedLines.push({ context, line, reason: 'unassigned_words' });
        continue;
      }
      if (HAS_URL.test(line.text)) (benches[benchIndex()] as NcltBench).hasVcLink = true;
      const hasCpColumn = header.columns.some((column) => column.key === 'cpNo');
      const rowLine = { line, assigned };
      if (!assembler.add(rowLine, opensRow(assigned, config, hasCpColumn), benchIndex())) {
        unparsedLines.push({ context, line, reason: 'no_row' });
      }
    }
  }

  const knownCodes = new Set(Object.keys(config.nomenclature.caseTypes));
  const unknownPrefixes: string[] = [];
  const noteUnknown = (reference: { prefix: string; code: string }) => {
    if (!knownCodes.has(reference.code) && !unknownPrefixes.includes(reference.prefix)) {
      unknownPrefixes.push(reference.prefix);
    }
  };
  const rows: NcltRow[] = [];
  const unparsedRows: NcltUnparsedRow[] = [];
  const pending: { anchor: Anchor | null; reason: NcltUnparsedRow['reason']; order: number }[] = [];
  for (const raw of assembler.result().rows) {
    const context = contexts.get(raw.page) as PageContext;
    const first = raw.lines[0] as RowLine;
    const words = raw.lines
      .filter((rowLine) => rowLine.line.page === raw.page)
      .flatMap((rowLine) => rowLine.line.words);
    const built = buildRow(raw, config);
    const anchor = anchorOf(context, first.line, rows.length, words);
    if (built.row === null || anchor === null) {
      pending.push({
        anchor: anchorOf(context, first.line, 0, words),
        reason: built.row === null ? (built.reason ?? 'no_row') : 'no_anchor',
        order: first.line.top + raw.page * 1e6,
      });
      continue;
    }
    noteUnknown(built.row.cp);
    for (const child of built.row.children) noteUnknown(child);
    rows.push({ ...built.row, benchIndex: raw.benchIndex, anchor });
  }
  for (const { context, line, reason } of unparsedLines) {
    pending.push({
      anchor: anchorOf(context, line, 0, line.words),
      reason,
      order: line.top + context.page * 1e6,
    });
  }
  pending.sort((a, b) => a.order - b.order);
  pending.forEach(({ anchor, reason }, index) => {
    unparsedRows.push({ reason, anchor: anchor === null ? null : { ...anchor, rowIndex: index } });
  });

  const firstBench = benches[0] ?? emptyBench();
  const columnKeys = new Set(firstHeader?.columns.map((column) => column.key) ?? []);
  return {
    status: 'parsed',
    listDate,
    bench: firstBench.bench,
    hearingMode: firstBench.hearingMode,
    hasVcLink: benches.some((bench) => bench.hasVcLink),
    benches,
    rows,
    unparsedRows,
    diagnostics: {
      headerFound: firstHeader !== null,
      missingColumns: firstHeader?.missing ?? Object.keys(table.columns),
      extraColumns: firstHeader?.extra ?? [],
      noCounselColumns:
        firstHeader !== null &&
        !columnKeys.has('counselPetitioner') &&
        !columnKeys.has('counselRespondent'),
      pagesNeedingOcr,
      unknownPrefixes,
    },
  };
}
