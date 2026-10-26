// Find the citations in a draft's block tree. Text lives in heading and paragraph blocks and in
// section titles; slot and narrative blocks hold no author text. A span is `[start, end)` in that
// block's own text and `blockId` is the stable block key from `walkBlocks`, so the same version
// always yields the same ids. A case name directly in front of a structured citation becomes that
// citation's title hint instead of an item of its own.
import type { CitationKind } from '@causedeck/validators/citation';

import { walkBlocks, type Block } from '../blocks';

import { CASE_NAME_LEAD, CASE_NAME_PATTERN, STRUCTURED_PATTERNS } from './patterns';

export interface ExtractedCitation {
  /** `<blockId>:<start>-<end>`. */
  id: string;
  blockId: string;
  span: [number, number];
  raw: string;
  normalized: string;
  kind: CitationKind;
  /** The `Party v. Party` name written just before a structured citation, if any. */
  titleHint?: string;
}

/** Longest gap (`, ` or ` (`) between a case name and the citation it names. */
const HINT_GAP = /^[\s,(]{0,4}$/;

function textOf(block: Block): string | undefined {
  if (block.type === 'heading' || block.type === 'paragraph') return block.text;
  if (block.type === 'section') return block.title;
  return undefined;
}

export function extractFromText(text: string, blockId: string): ExtractedCitation[] {
  const items: ExtractedCitation[] = [];
  for (const pattern of STRUCTURED_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))) {
      const start = match.index;
      const end = start + match[0].length;
      items.push({
        id: `${blockId}:${String(start)}-${String(end)}`,
        blockId,
        span: [start, end],
        raw: match[0],
        normalized: pattern.normalize(match as RegExpExecArray),
        kind: pattern.kind,
      });
    }
  }
  const names: { start: number; end: number; raw: string; normalized: string }[] = [];
  for (const match of text.matchAll(
    new RegExp(CASE_NAME_PATTERN.regex.source, CASE_NAME_PATTERN.regex.flags),
  )) {
    const lead = CASE_NAME_LEAD.exec(match[0])?.[0].length ?? 0;
    const raw = match[0].slice(lead);
    const start = match.index + lead;
    names.push({
      start,
      end: match.index + match[0].length,
      raw,
      normalized: raw.replace(/\s+/g, ' '),
    });
  }
  const absorbed = new Set<number>();
  for (const item of items) {
    const idx = names.findIndex(
      (n) => n.end <= item.span[0] && HINT_GAP.test(text.slice(n.end, item.span[0])),
    );
    const name = names[idx];
    if (name !== undefined) {
      item.titleHint = name.raw;
      absorbed.add(idx);
    }
  }
  names.forEach((name, idx) => {
    if (absorbed.has(idx)) return;
    items.push({
      id: `${blockId}:${String(name.start)}-${String(name.end)}`,
      blockId,
      span: [name.start, name.end],
      raw: name.raw,
      normalized: name.normalized,
      kind: 'case_name',
    });
  });
  return items.sort((a, b) => a.span[0] - b.span[0] || a.span[1] - b.span[1]);
}

/** Every citation in the block tree, in document order. */
export function extractCitations(blocks: readonly Block[]): ExtractedCitation[] {
  const items: ExtractedCitation[] = [];
  walkBlocks(blocks, ({ block, key }) => {
    const text = textOf(block);
    if (text !== undefined) items.push(...extractFromText(text, key));
  });
  return items;
}
