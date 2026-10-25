// Karnataka HC cause list from a saved HTML list page (#405, part 2 of #37). parse5 builds the tree
// (unclosed tags are repaired by the HTML5 rules; scripts never run) and this walks it in document
// order into list-reader events: text outside tables and single-cell rows become lines, a row whose
// cells all name columns (`karnatakaHcColumnOf`) is the table's header, and later rows are cells.
// A row that holds a nested table is a layout container: its tables are read, not the row. The
// text of the link in the case-number cell is the case number. Anchors quote the row as
// `layoutFromHtml` writes it (cells joined by tabs), or the case-number cell when the row is split
// across lines there. Nothing here requests a URL.
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import type { AdapterConfig } from '../config/schema.ts';
import { layoutFromHtml } from '../layout/html.ts';
import type { ParsedCauseList, ParserInput } from '../types.ts';

import { karnatakaHcColumnOf, type KarnatakaHcColumn } from './config/column-synonyms.ts';
import { readKarnatakaList, type ListCellsEvent, type ListEvent } from './list-reader.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

export interface KarnatakaCauseListOptions {
  config: AdapterConfig;
  version: string;
}

const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'iframe', 'object']);
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'center',
  'dd',
  'div',
  'dl',
  'dt',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'ul',
]);
const SECTIONS = new Set(['thead', 'tbody', 'tfoot']);

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();
const isElement = (node: Node): node is Element => 'tagName' in node;
const childrenOf = (node: Node): Node[] => ('childNodes' in node ? node.childNodes : []);

/** The visible text of a node, inline (no line breaks). */
function textOf(node: Node): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value;
  if (isElement(node) && SKIPPED.has(node.tagName)) return '';
  if (isElement(node) && node.tagName === 'br') return ' ';
  if (node.nodeName === '#comment') return '';
  return childrenOf(node).map(textOf).join('');
}

function contains(node: Node, tag: string): boolean {
  return childrenOf(node).some((child) => {
    if (!isElement(child)) return false;
    if (SKIPPED.has(child.tagName)) return false;
    return child.tagName === tag || contains(child, tag);
  });
}

function firstLinkText(node: Node): string | undefined {
  for (const child of childrenOf(node)) {
    if (!isElement(child) || SKIPPED.has(child.tagName)) continue;
    if (child.tagName === 'a') {
      const text = collapse(textOf(child));
      if (text !== '') return text;
    }
    const nested = firstLinkText(child);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/** The rows of a table, not those of tables nested in its cells. */
function rowsOf(table: Element): Element[] {
  const rows: Element[] = [];
  for (const child of table.childNodes) {
    if (!isElement(child)) continue;
    if (child.tagName === 'tr') rows.push(child);
    else if (SECTIONS.has(child.tagName)) {
      for (const row of child.childNodes)
        if (isElement(row) && row.tagName === 'tr') rows.push(row);
    }
  }
  return rows;
}

const cellsOf = (row: Element): Element[] =>
  row.childNodes.filter(
    (cell): cell is Element => isElement(cell) && (cell.tagName === 'td' || cell.tagName === 'th'),
  );

class EventWriter {
  readonly events: ListEvent[] = [];
  private current = '';

  constructor(private readonly pageText: string) {}

  write(text: string): void {
    this.current += text;
  }

  break(): void {
    const text = collapse(this.current);
    if (text !== '') this.events.push({ kind: 'line', page: 1, text });
    this.current = '';
  }

  /** The anchor quote of a row: as `layoutFromHtml` writes it, else its case-number cell. */
  quoteOf(texts: readonly string[], caseText: string): string {
    const line = texts.filter((text) => text !== '').join('\t');
    return this.pageText.includes(line) || caseText === '' ? line : caseText;
  }
}

function readTable(table: Element, out: EventWriter): void {
  out.break();
  let columns: (KarnatakaHcColumn | null)[] | null = null;
  for (const row of rowsOf(table)) {
    const cells = cellsOf(row);
    if (cells.some((cell) => contains(cell, 'table'))) {
      // A layout row: read what its cells hold, nested tables included.
      for (const cell of cells) walk(cell, out);
      out.break();
      continue;
    }
    const texts = cells.map((cell) => collapse(textOf(cell)));
    const filled = texts.filter((text) => text !== '');
    if (filled.length === 0) continue;
    const named = texts.map((text) => (text === '' ? null : karnatakaHcColumnOf(text)));
    if (
      filled.length >= 2 &&
      named.includes('caseNo') &&
      named.every((c, i) => c !== null || texts[i] === '')
    ) {
      columns = named;
      out.events.push({ kind: 'header', page: 1 });
      continue;
    }
    if (columns === null || filled.length === 1) {
      // A heading row (`colspan`), or a table that is not the list: each cell is a line.
      for (const text of filled) out.events.push({ kind: 'line', page: 1, text });
      continue;
    }
    const values: Partial<Record<KarnatakaHcColumn, string>> = {};
    let caseNoAnchorText: string | undefined;
    for (const [index, column] of columns.entries()) {
      if (column === null) continue;
      values[column] = texts[index] ?? '';
      const cell = cells[index];
      if (column === 'caseNo' && cell !== undefined) caseNoAnchorText = firstLinkText(cell);
    }
    const event: ListCellsEvent = {
      kind: 'cells',
      page: 1,
      quote: out.quoteOf(texts, values.caseNo ?? ''),
      cells: values,
      caseNoAnchorText,
    };
    out.events.push(event);
  }
}

function walk(node: Node, out: EventWriter): void {
  if (node.nodeName === '#text' && 'value' in node) {
    out.write(node.value);
    return;
  }
  if (!isElement(node) && node.nodeName !== '#document' && node.nodeName !== '#document-fragment') {
    return;
  }
  if (isElement(node)) {
    if (SKIPPED.has(node.tagName)) return;
    if (node.tagName === 'br') {
      out.break();
      return;
    }
    if (node.tagName === 'table') {
      readTable(node, out);
      return;
    }
  }
  const block = isElement(node) && (BLOCKS.has(node.tagName) || node.tagName === 'tr');
  if (block) out.break();
  for (const child of childrenOf(node)) walk(child, out);
  if (block) out.break();
}

/** Parses a supplied Karnataka HC cause-list HTML page. */
export function parseKarnatakaCauseListHtml(
  input: ParserInput,
  { config, version }: KarnatakaCauseListOptions,
): ParsedCauseList {
  const html = input.html ?? '';
  const [page] = layoutFromHtml(html).pages;
  const text = page?.text ?? '';
  const out = new EventWriter(text);
  walk(parse(html), out);
  out.break();
  return readKarnatakaList([{ page: 1, text, readable: text.trim() !== '' }], out.events, {
    config,
    version,
    forumCode: input.meta.forumCode,
    source: 'html',
    fileName: input.meta.fileName,
  });
}
