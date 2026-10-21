// Table columns from word coordinates (#38, ADR 0018). An NCLT list is a table in a PDF, so lines
// are not a grammar: words are grouped into visual lines by their tops, the header row is the line
// (or the two-line band, for wrapped header cells) whose x-gap clusters match at least
// `minHeaderMatches` known column names, and every body word is assigned to the column whose header
// starts at or left of it (less `columnTolerancePx`). A word that runs into the next column's header
// cannot be assigned, and its line is reported rather than guessed. Pure.
import type { BBox } from '../../types.ts';
import { headerKey } from '../config/columns.ts';

export interface Word {
  text: string;
  bbox: BBox;
}

/** A visual line: words sharing a top, left to right. */
export interface Line {
  page: number;
  words: Word[];
  top: number;
  bottom: number;
  /** The words joined by single spaces. */
  text: string;
}

export interface TableConfig {
  columns: Readonly<Record<string, readonly string[]>>;
  minHeaderMatches: number;
  columnTolerancePx: number;
}

export interface Column {
  /** A canonical key, or `extra:<header>` for a column the config does not know. */
  key: string;
  known: boolean;
  header: string;
  x0: number;
  x1: number;
}

export interface TableHeader {
  /** Left to right. */
  columns: Column[];
  /** Canonical keys with no header cell. */
  missing: string[];
  /** Header text of columns the config does not know. */
  extra: string[];
  /** Lines the header occupies (1, or 2 for wrapped header cells). */
  lineCount: number;
}

export interface AssignedLine {
  /** Text per column key, words in reading order. */
  cells: Record<string, string>;
  /** Words per column key. */
  words: Record<string, Word[]>;
  /** Words that fit no column. */
  unassigned: Word[];
}

/** Groups words into lines (tops within half a word height), top to bottom, left to right. */
export function groupLines(page: number, words: readonly Word[]): Line[] {
  const sorted = [...words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const groups: { top: number; words: Word[] }[] = [];
  for (const word of sorted) {
    const last = groups.at(-1);
    const tolerance = Math.max(1, word.bbox.height / 2);
    if (last !== undefined && Math.abs(word.bbox.y - last.top) <= tolerance) {
      last.words.push(word);
    } else {
      groups.push({ top: word.bbox.y, words: [word] });
    }
  }
  return groups.map(({ top, words: lineWords }) => {
    const ordered = lineWords.sort((a, b) => a.bbox.x - b.bbox.x);
    return {
      page,
      words: ordered,
      top,
      bottom: Math.max(...ordered.map((w) => w.bbox.y + w.bbox.height)),
      text: ordered.map((w) => w.text).join(' '),
    };
  });
}

/** Header cells: words whose x-ranges touch (within `gap`) belong to one cell. */
function headerCells(lines: readonly Line[]): { text: string; x0: number; x1: number }[] {
  const words = lines.flatMap((line, lineIndex) => line.words.map((word) => ({ word, lineIndex })));
  if (words.length === 0) return [];
  const heights = words.map(({ word }) => word.bbox.height).sort((a, b) => a - b);
  const gap = 0.6 * (heights[Math.floor(heights.length / 2)] ?? 0);
  const byX = [...words].sort((a, b) => a.word.bbox.x - b.word.bbox.x);
  const cells: { members: typeof words; x0: number; x1: number }[] = [];
  for (const entry of byX) {
    const { x, width } = entry.word.bbox;
    const last = cells.at(-1);
    if (last !== undefined && x <= last.x1 + gap) {
      last.members.push(entry);
      last.x1 = Math.max(last.x1, x + width);
    } else {
      cells.push({ members: [entry], x0: x, x1: x + width });
    }
  }
  return cells.map(({ members, x0, x1 }) => ({
    text: members
      .sort((a, b) => a.lineIndex - b.lineIndex || a.word.bbox.x - b.word.bbox.x)
      .map(({ word }) => word.text)
      .join(' '),
    x0,
    x1,
  }));
}

const synonymCache = new WeakMap<TableConfig['columns'], Map<string, string>>();

/** Normalised header spelling -> column key, built once per config. */
function synonymsOf(columns: TableConfig['columns']): Map<string, string> {
  let synonyms = synonymCache.get(columns);
  if (synonyms === undefined) {
    synonyms = new Map<string, string>();
    for (const [key, spellings] of Object.entries(columns)) {
      for (const spelling of spellings) {
        const normal = headerKey(spelling);
        if (!synonyms.has(normal)) synonyms.set(normal, key);
      }
    }
    synonymCache.set(columns, synonyms);
  }
  return synonyms;
}

const tokenCache = new WeakMap<TableConfig['columns'], Set<string>>();

/**
 * A cheap screen before clustering: most of a header line's words are words of column names
 * (`Sl.`, `No.`, `Counsel`, `for`, ...), which a body line's words rarely are.
 */
function looksLikeHeader(line: Line, columns: TableConfig['columns']): boolean {
  let tokens = tokenCache.get(columns);
  if (tokens === undefined) {
    tokens = new Set(
      Object.values(columns).flatMap((spellings) =>
        spellings.flatMap((spelling) => spelling.split(/\s+/).map(headerKey)),
      ),
    );
    tokenCache.set(columns, tokens);
  }
  const known = tokens;
  const hits = line.words.filter((word) => known.has(headerKey(word.text))).length;
  return hits >= 3 && hits >= 0.6 * line.words.length;
}

function matchHeader(
  lines: readonly Line[],
  config: TableConfig,
): TableHeader & { matched: number } {
  const synonyms = synonymsOf(config.columns);
  const seen = new Set<string>();
  const extra: string[] = [];
  const columns = headerCells(lines).map((cell): Column => {
    const key = synonyms.get(headerKey(cell.text));
    if (key !== undefined && !seen.has(key)) {
      seen.add(key);
      return { key, known: true, header: cell.text, x0: cell.x0, x1: cell.x1 };
    }
    extra.push(cell.text);
    return { key: `extra:${headerKey(cell.text)}`, known: false, ...cell, header: cell.text };
  });
  return {
    columns,
    missing: Object.keys(config.columns).filter((key) => !seen.has(key)),
    extra,
    lineCount: lines.length,
    matched: seen.size,
  };
}

/**
 * The table header starting at `lines[index]`, or null. The line alone and the line with the next
 * one (when it follows within a line height) are both tried; the one matching more columns wins.
 */
export function detectHeader(
  lines: readonly Line[],
  index: number,
  config: TableConfig,
): TableHeader | null {
  const line = lines[index];
  if (line === undefined || !looksLikeHeader(line, config.columns)) return null;
  let best = matchHeader([line], config);
  const next = lines[index + 1];
  const height = line.bottom - line.top;
  if (next !== undefined && next.top - line.bottom < height) {
    const band = matchHeader([line, next], config);
    if (band.matched > best.matched) best = band;
  }
  if (best.matched < config.minHeaderMatches) return null;
  return {
    columns: best.columns,
    missing: best.missing,
    extra: best.extra,
    lineCount: best.lineCount,
  };
}

/**
 * Assigns a line's words to the header's columns: a word belongs to the right-most column whose
 * header starts at or left of it (less the tolerance), unless it runs past the start of the next
 * column's header by more than the tolerance.
 */
export function assignColumns(
  line: Line,
  header: TableHeader,
  columnTolerancePx: number,
): AssignedLine {
  const words: Record<string, Word[]> = {};
  const unassigned: Word[] = [];
  const { columns } = header;
  for (const word of line.words) {
    let index = -1;
    for (let i = 0; i < columns.length; i += 1) {
      if ((columns[i]?.x0 ?? 0) - columnTolerancePx <= word.bbox.x) index = i;
    }
    const column = columns[index];
    const next = columns[index + 1];
    if (
      column === undefined ||
      (next !== undefined && word.bbox.x + word.bbox.width > next.x0 + columnTolerancePx)
    ) {
      unassigned.push(word);
      continue;
    }
    (words[column.key] ??= []).push(word);
  }
  const cells: Record<string, string> = {};
  for (const [key, cellWords] of Object.entries(words)) {
    cells[key] = cellWords.map((w) => w.text).join(' ');
  }
  return { cells, words, unassigned };
}

/** The bbox around `words` (top-left origin), or undefined for none. */
export function unionBox(words: readonly Word[]): BBox | undefined {
  if (words.length === 0) return undefined;
  const round = (value: number) => Math.round(value * 100) / 100;
  const left = Math.min(...words.map((w) => w.bbox.x));
  const top = Math.min(...words.map((w) => w.bbox.y));
  const right = Math.max(...words.map((w) => w.bbox.x + w.bbox.width));
  const bottom = Math.max(...words.map((w) => w.bbox.y + w.bbox.height));
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) };
}
