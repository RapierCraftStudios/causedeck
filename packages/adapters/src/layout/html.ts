// HTML layout reader (#370, ADR 0015): the visible text of an HTML document the lawyer supplied
// (a saved list page, an email body) as a one-page `LayoutDocument`. parse5 only builds a tree;
// scripts, styles, templates and comments are skipped, never evaluated. HTML has no coordinates,
// so the page has width and height 0 and no items.
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import type { LayoutDocument } from '../types.ts';

type Node = DefaultTreeAdapterTypes.Node;

/** Elements whose content is never visible text. */
const SKIPPED = new Set(['script', 'style', 'noscript', 'template', 'head', 'iframe', 'object']);

/** Elements that start and end a line. */
const BLOCKS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
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
  'table',
  'tbody',
  'tfoot',
  'thead',
  'tr',
  'ul',
]);

const CELLS = new Set(['td', 'th']);

class LineWriter {
  readonly lines: string[] = [];
  private current: string[] = [];

  /** Appends inline text; `break` collapses its whitespace to single spaces, as a browser shows it. */
  write(text: string): void {
    this.current.push(text);
  }

  /** Starts a table cell: cells of one row are joined with a tab. */
  cell(): void {
    if (this.current.length > 0) this.current.push('\t');
  }

  break(): void {
    const line = this.current
      .join('')
      .split('\t')
      .map((cell) => cell.replaceAll(/\s+/g, ' ').trim())
      .filter((cell) => cell !== '')
      .join('\t');
    if (line !== '') this.lines.push(line);
    this.current = [];
  }
}

function walk(node: Node, out: LineWriter, inPre: boolean): void {
  if (node.nodeName === '#text' && 'value' in node) {
    if (inPre) {
      const [first = '', ...rest] = node.value.split(/\r?\n/);
      out.write(first);
      for (const line of rest) {
        out.break();
        out.write(line);
      }
    } else {
      out.write(node.value);
    }
    return;
  }
  if (!('childNodes' in node) || node.nodeName === '#comment') return;
  const name = node.nodeName;
  if (SKIPPED.has(name)) return;
  if (name === 'br') {
    out.break();
    return;
  }
  const block = BLOCKS.has(name);
  if (block) out.break();
  if (CELLS.has(name)) out.cell();
  for (const child of node.childNodes) walk(child, out, inPre || name === 'pre');
  if (block) out.break();
}

/** Reads the visible text of `html` into a single-page `LayoutDocument`, one line per block. */
export function layoutFromHtml(html: string): LayoutDocument {
  const out = new LineWriter();
  walk(parse(html), out, false);
  out.break();
  const text = out.lines.join('\n');
  return {
    pages: [
      {
        page: 1,
        width: 0,
        height: 0,
        text,
        items: [],
        words: [],
        textCoverage: text.trim() === '' ? 0 : 1,
      },
    ],
  };
}
