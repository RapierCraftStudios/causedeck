// The A0 skeleton (#56): the deterministic pass that runs before any model call. It reads case
// references (every registered adapter's nomenclature plus the district types), CNRs, date
// literals in English, Tamil and Kannada digit forms, headings and table rows from the layout, and
// anchors each to its line of the page. Its output is the model's hints and the whole answer when
// the model is unavailable, over budget or not allowed (sensitive matters, `ai_blocked` captures).
import { findDateLiterals, type PageText } from '@causedeck/intelligence/extract';
import { detectDocumentLanguage } from '@causedeck/intelligence/language';

import type { LayoutDocument } from '../types.ts';

import {
  buildCaseTypeLookup,
  CNR_IN_TEXT,
  findCaseRefs,
  type CaseRefHit,
  type CaseTypeLookup,
} from './patterns.ts';

export interface SkeletonSpan {
  page: number;
  /** Offsets into the page text. */
  start: number;
  end: number;
  quote: string;
}

export interface SkeletonDate extends SkeletonSpan {
  /** `YYYY-MM-DD`, from a literal written in `quote`. */
  date: string;
  literal: string;
}

export interface SkeletonHeading extends SkeletonSpan {
  kind: 'stage' | 'hall';
  /** The hall number or name for `hall`, the heading text for `stage`. */
  text: string;
}

export interface SkeletonRow extends SkeletonSpan {
  /** 1-based line of the page, counting every line. */
  lineRef: number;
  serial: string | null;
  ref: CaseRefHit;
  cnr: string | null;
  parties: string | null;
  stageText: string | null;
  hall: string | null;
  dates: SkeletonDate[];
  /** The layout's cells for this row when the page has a table (>= 3 aligned cells). */
  cells: string[];
}

export interface Skeleton {
  rows: SkeletonRow[];
  cnrs: (SkeletonSpan & { value: string })[];
  dates: SkeletonDate[];
  headings: SkeletonHeading[];
  listDate: SkeletonDate | null;
  /** Language tag of the whole document (`en`, `ta`, `kn`, `ta+en`, `kn+en`), or null. */
  language: string | null;
  /** Rows the layout showed as table rows (>= 3 aligned cells). */
  tableRows: number;
}

export interface SkeletonOptions {
  lookup?: CaseTypeLookup;
  layout?: LayoutDocument | undefined;
  /** Two-digit year pivot of the forum config. */
  pivot?: number;
}

const HALL_HEADING =
  /^\s*(?:court\s*hall|court\s*room|court|hall)\s*(?:no\.?|number)?\s*[:.-]?\s*([A-Za-z0-9-]+)\s*$/i;
const SERIAL = /^\s*(\d{1,4})\s*[.)-]?\s+/;
const SCRIPT = /[஀-௿ಀ-೿]/u;

/** Pages in the shape the validators use, from a layout (`textSource` says where text came from). */
export function pagesFromLayout(
  layout: LayoutDocument,
  textSource: PageText['textSource'] = 'layer',
): PageText[] {
  return layout.pages.map((p) => ({ pageNo: p.page, text: p.text, textSource }));
}

interface Line {
  text: string;
  start: number;
  end: number;
  no: number;
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let at = 0;
  let no = 0;
  for (const raw of text.split('\n')) {
    no += 1;
    lines.push({ text: raw, start: at, end: at + raw.length, no });
    at += raw.length + 1;
  }
  return lines;
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Table rows of a layout page: items sharing a baseline, left to right, with >= 3 cells. */
function layoutRows(page: LayoutDocument['pages'][number]): { text: string; cells: string[] }[] {
  const items = [...page.items].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const rows: { y: number; cells: { x: number; text: string }[] }[] = [];
  for (const item of items) {
    const row = rows.find((r) => Math.abs(r.y - item.bbox.y) <= 3);
    if (row === undefined)
      rows.push({ y: item.bbox.y, cells: [{ x: item.bbox.x, text: item.text }] });
    else row.cells.push({ x: item.bbox.x, text: item.text });
  }
  return rows
    .filter((r) => r.cells.length >= 3)
    .map((r) => {
      const cells = r.cells.sort((a, b) => a.x - b.x).map((c) => squash(c.text));
      return { text: squash(cells.join(' ')), cells };
    });
}

function isHeading(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 80) return false;
  if (/\d{4}/.test(t) || /\bvs?\b\.?/i.test(t)) return false;
  if (/\b(court of|cause list|sl\.?\s*no|case\s*no|parties|fictional)\b/i.test(t)) return false;
  if (t.endsWith(':')) return true;
  const latin = t.replace(/[^A-Za-z]/g, '');
  if (latin.length >= 3 && latin === latin.toUpperCase() && !SCRIPT.test(t)) return true;
  return SCRIPT.test(t) && t.length <= 40 && !/\d/.test(t);
}

function cleanParties(text: string): string | null {
  const cleaned = text
    .replace(CNR_IN_TEXT, ' ')
    .replace(/\bCNR\b\s*[:\-–]?/gi, ' ')
    .replace(/^[\s,:;|\-–]+/, '')
    .replace(/[\s,:;|\-–]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned.length >= 3 && !/^\d+$/.test(cleaned) ? cleaned : null;
}

export function skeletonPass(pages: readonly PageText[], options: SkeletonOptions = {}): Skeleton {
  const lookup = options.lookup ?? buildCaseTypeLookup();
  const pivot = options.pivot === undefined ? {} : { pivot: options.pivot };
  const rows: SkeletonRow[] = [];
  const cnrs: Skeleton['cnrs'] = [];
  const dates: SkeletonDate[] = [];
  const headings: SkeletonHeading[] = [];
  let tableRows = 0;
  let listDate: SkeletonDate | null = null;
  let stageText: string | null = null;
  let hall: string | null = null;

  for (const page of pages) {
    const layoutPage = options.layout?.pages.find((p) => p.page === page.pageNo);
    const table = layoutPage === undefined ? [] : layoutRows(layoutPage);
    for (const line of linesOf(page.text)) {
      const span = (start: number, end: number): SkeletonSpan => ({
        page: page.pageNo,
        start: line.start + start,
        end: line.start + end,
        quote: line.text.slice(start, end),
      });
      const lineDates = findDateLiterals(line.text).map((d): SkeletonDate => ({
        ...span(d.start, d.end),
        date: d.date,
        literal: d.literal,
      }));
      dates.push(...lineDates);
      const lineCnrs = [...line.text.matchAll(CNR_IN_TEXT)].map((m) => ({
        ...span(m.index, m.index + m[0].length),
        value: m[0],
      }));
      cnrs.push(...lineCnrs);

      const refs = findCaseRefs(line.text, lookup, pivot);
      if (refs.length === 0) {
        const hallMatch = HALL_HEADING.exec(line.text);
        if (hallMatch !== null) {
          hall = hallMatch[1] ?? null;
          headings.push({ ...span(0, line.text.length), kind: 'hall', text: hall ?? '' });
        } else if (lineDates.length === 0 && isHeading(line.text)) {
          stageText = line.text.trim();
          headings.push({ ...span(0, line.text.length), kind: 'stage', text: stageText });
        } else if (listDate === null && rows.length === 0 && lineDates[0] !== undefined) {
          listDate = lineDates[0];
        }
        continue;
      }

      const layoutRow = table.find((r) => r.text === squash(line.text));
      if (layoutRow !== undefined) tableRows += 1;
      refs.forEach((ref, index) => {
        const next = refs[index + 1];
        const serial =
          index === 0 ? (SERIAL.exec(line.text.slice(0, ref.start))?.[1] ?? null) : null;
        const after = line.text.slice(ref.end, next?.start ?? line.text.length);
        let parties = cleanParties(
          after.replace(/^\s*(?:and|&)\s*$/i, '').replace(/^\s*(?:and|&)\s+/i, ''),
        );
        if (layoutRow !== undefined) {
          const at = layoutRow.cells.findIndex((c) =>
            c.includes(squash(line.text.slice(ref.start, ref.end))),
          );
          const cell = at >= 0 ? layoutRow.cells[at + 1] : undefined;
          if (cell !== undefined && findDateLiterals(cell).length === 0)
            parties = cleanParties(cell);
        }
        rows.push({
          ...span(0, line.text.length),
          lineRef: line.no,
          serial,
          ref,
          cnr: lineCnrs[0]?.value ?? null,
          parties,
          stageText,
          hall,
          dates: lineDates,
          cells: layoutRow?.cells ?? [],
        });
      });
    }
  }
  return {
    rows,
    cnrs,
    dates,
    headings,
    listDate,
    language: detectDocumentLanguage(pages.map((p) => p.text)),
    tableRows,
  };
}
