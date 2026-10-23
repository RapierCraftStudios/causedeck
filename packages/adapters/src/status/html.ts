// Shared reader for the case-status result pages (#590). parse5 builds the tree (unclosed tags are
// repaired, scripts never run); every table row becomes a list of cells. Label/value pairs are the
// consecutive cell pairs of a row (`<th>Label</th><td>Value</td>`, or two pairs per row); a table
// whose header row names the order columns is read as the orders list. Pure: no URL is requested.
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import type { StageMapEntry } from '../config/schema.ts';
import { normaliseCaseNumber } from '../normalise/case-number.ts';
import { normaliseDate } from '../normalise/date.ts';
import { normaliseStage } from '../normalise/stage.ts';

import type { CaseStatusOrder, CaseStatusTemplate, ParsedCaseStatus } from './types.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

export interface Cell {
  text: string;
  href: string | null;
}
export type Row = Cell[];

const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head']);
const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const isElement = (node: Node): node is Element => 'tagName' in node;
const childrenOf = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : []);

function textOf(node: Node): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value;
  if (isElement(node) && SKIPPED.has(node.tagName)) return '';
  if (isElement(node) && node.tagName === 'br') return ' ';
  return childrenOf(node).map(textOf).join('');
}

function firstHref(node: Node): string | null {
  if (isElement(node) && node.tagName === 'a') {
    return node.attrs.find((attr) => attr.name === 'href')?.value.trim() || null;
  }
  for (const child of childrenOf(node)) {
    const href = firstHref(child);
    if (href !== null) return href;
  }
  return null;
}

/** Rows of every table in document order; a row holding a nested table is a container, skipped. */
function readTables(node: Node, tables: Row[][]): void {
  if (!isElement(node) || SKIPPED.has(node.tagName)) {
    for (const child of childrenOf(node)) readTables(child, tables);
    return;
  }
  if (node.tagName === 'table') {
    const rows: Row[] = [];
    const visit = (parent: Node) => {
      for (const child of childrenOf(parent)) {
        if (!isElement(child)) continue;
        if (child.tagName === 'tr') {
          const cells = childrenOf(child).filter(
            (cell): cell is Element =>
              isElement(cell) && (cell.tagName === 'td' || cell.tagName === 'th'),
          );
          if (cells.some((cell) => childrenOf(cell).some(hasTable))) {
            for (const cell of cells) readTables(cell, tables);
          } else {
            rows.push(
              cells.map((cell) => ({ text: collapse(textOf(cell)), href: firstHref(cell) })),
            );
          }
        } else if (child.tagName !== 'table') visit(child);
      }
    };
    visit(node);
    tables.push(rows);
    return;
  }
  for (const child of childrenOf(node)) readTables(child, tables);
}

function hasTable(node: Node): boolean {
  return (isElement(node) && node.tagName === 'table') || childrenOf(node).some(hasTable);
}

export interface PageSpec {
  template: CaseStatusTemplate;
  /** Label regexes (matched against the lower-cased label without a trailing colon). */
  labels: {
    cnr: RegExp;
    caseNumber: RegExp;
    nextHearingDate: RegExp;
    lastHearingDate: RegExp;
    stage: RegExp;
    bench: RegExp;
  };
  /** Header-cell regexes that locate the orders table and its columns. */
  orderColumns: { date: RegExp; number: RegExp; summary: RegExp };
}

/** Normalised stage keys; the first match wins, an unknown heading keeps a null key. */
export const STATUS_STAGE_MAP: readonly StageMapEntry[] = [
  { pattern: '\\b(disposed|decided|dismissed|allowed)\\b', flags: 'i', key: 'disposed' },
  { pattern: '\\bjudg(e)?ment\\b', flags: 'i', key: 'judgment' },
  { pattern: '\\barguments?\\b', flags: 'i', key: 'arguments' },
  { pattern: '\\bevidence\\b', flags: 'i', key: 'evidence' },
  { pattern: '\\b(admission|notice)\\b', flags: 'i', key: 'admission' },
  { pattern: '\\b(filing|registration|scrutiny)\\b', flags: 'i', key: 'filing' },
  { pattern: '\\b(hearing|final|posted)\\b', flags: 'i', key: 'hearing' },
];

const CNR = /\b[A-Z]{4}\d{2}\d{6}\d{4}\b/;
const NOT_FOUND = /\b(no records? found|record not found|no data found|case not found|invalid)\b/i;

const labelOf = (text: string) =>
  collapse(text)
    .replace(/\s*:\s*$/, '')
    .toLowerCase();

/** The value cell of the first label/value pair whose label matches `pattern`. */
function pairValue(rows: Row[], pattern: RegExp): Cell | null {
  for (const row of rows) {
    for (let index = 0; index + 1 < row.length; index += 2) {
      const label = row[index];
      const value = row[index + 1];
      if (
        label !== undefined &&
        value !== undefined &&
        value.text !== '' &&
        pattern.test(labelOf(label.text))
      ) {
        return value;
      }
    }
  }
  return null;
}

function readOrders(tables: Row[][], columns: PageSpec['orderColumns']): CaseStatusOrder[] {
  for (const rows of tables) {
    const header = rows[0];
    if (header === undefined) continue;
    const at = (pattern: RegExp) => header.findIndex((cell) => pattern.test(labelOf(cell.text)));
    const date = at(columns.date);
    if (date < 0 || header.length < 2) continue;
    const number = at(columns.number);
    const summary = at(columns.summary);
    const orders: CaseStatusOrder[] = [];
    for (const row of rows.slice(1)) {
      const cellText = (index: number) => (index < 0 ? undefined : row[index]?.text) || null;
      const iso = normaliseDate(row[date]?.text ?? '');
      const href = row.map((cell) => cell.href).find((value) => value !== null) ?? null;
      if (iso === null && href === null) continue;
      orders.push({ date: iso, number: cellText(number), summary: cellText(summary), href });
    }
    return orders;
  }
  return [];
}

/** Reads one status result page; never throws, whatever `html` holds. */
export function readStatusPage(html: string, spec: PageSpec): ParsedCaseStatus {
  const tables: Row[][] = [];
  let pageText = '';
  try {
    const tree = parse(html);
    readTables(tree, tables);
    pageText = collapse(textOf(tree));
  } catch {
    // unreadable markup is reported as `unrecognised` below
  }
  const rows = tables.flat();
  const quotes: Record<string, string> = {};
  const scalar = (pattern: RegExp): Cell | null => pairValue(rows, pattern);
  /** Records the cell text a value was read from; nothing is quoted for a value that is null. */
  const keep = <T>(field: string, cell: Cell | null, value: T | null): T | null => {
    if (cell !== null && value !== null) quotes[field] = cell.text;
    return value;
  };
  const dateOf = (field: string, pattern: RegExp) => {
    const cell = scalar(pattern);
    return keep(field, cell, cell === null ? null : normaliseDate(cell.text));
  };

  const cnrCell = scalar(spec.labels.cnr);
  const cnr = keep(
    'cnr',
    cnrCell,
    cnrCell === null ? null : (CNR.exec(cnrCell.text.toUpperCase())?.[0] ?? null),
  );
  const caseCell = scalar(spec.labels.caseNumber);
  const caseNumber = keep(
    'caseNumber',
    caseCell,
    caseCell === null ? null : collapse(caseCell.text),
  );
  const stageCell = scalar(spec.labels.stage);
  const normalisedStage =
    stageCell === null ? null : normaliseStage(stageCell.text, STATUS_STAGE_MAP);
  const stage = keep(
    'stage',
    stageCell,
    normalisedStage === null
      ? null
      : { raw: normalisedStage.stageRaw, norm: normalisedStage.stageNorm },
  );
  const benchCell = scalar(spec.labels.bench);
  const bench = keep('bench', benchCell, benchCell?.text ?? null);
  const nextHearingDate = dateOf('nextHearingDate', spec.labels.nextHearingDate);
  const lastHearingDate = dateOf('lastHearingDate', spec.labels.lastHearingDate);
  const orders = readOrders(tables, spec.orderColumns);

  const found =
    cnr !== null ||
    nextHearingDate !== null ||
    lastHearingDate !== null ||
    stage !== null ||
    orders.length > 0 ||
    (caseNumber !== null && normaliseCaseNumber(caseNumber) !== null);
  const status = found ? 'ok' : NOT_FOUND.test(pageText) ? 'not_found' : 'unrecognised';
  return {
    template: spec.template,
    status,
    cnr,
    caseNumber,
    nextHearingDate,
    lastHearingDate,
    stage,
    bench,
    orders,
    quotes,
  };
}
