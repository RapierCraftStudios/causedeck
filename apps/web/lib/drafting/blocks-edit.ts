// Pure helpers behind the drafting studio's editor (#827): block keys, text edits that clear the
// AI-drafted marker and record an edit diff, fact insertion, `[[missing]]` markers, findings and the
// line diff the version drawer previews. Types only from validators: the render libraries of
// `@causedeck/drafting` must stay out of the client bundle.
import type { Block } from '@causedeck/validators/drafting';

/** `[[missing: matter.cnr]]`, written by the slot resolver when a fact is unknown. */
const MISSING = /\[\[missing(?::\s*([^\]]*))?\]\]/g;

export interface KeyedBlock {
  block: Block;
  key: string;
}

/** Same keys as `walkBlocks` in `@causedeck/drafting`: the block's id, else its position path. */
export function keyedBlocks(blocks: readonly Block[], prefix = 'b'): KeyedBlock[] {
  return blocks.flatMap((block, index): KeyedBlock[] => {
    const key = block.id ?? `${prefix}.${String(index)}`;
    const children =
      block.type === 'section' || block.type === 'list'
        ? keyedBlocks(block.children, `${prefix}.${String(index)}`)
        : [];
    return [{ block, key }, ...children];
  });
}

/** An edit of AI-drafted text: what the model wrote and what the lawyer made of it. */
export interface EditDiff {
  blockKey: string;
  before: string;
  after: string;
}

export interface EditResult {
  blocks: Block[];
  /** Set when the edit replaced AI-drafted text for the first time. */
  diff?: EditDiff;
}

function mapBlocks(
  blocks: readonly Block[],
  key: string,
  change: (block: Block) => Block,
  prefix = 'b',
): Block[] {
  return blocks.map((block, index) => {
    const path = `${prefix}.${String(index)}`;
    if ((block.id ?? path) === key) return change(block);
    if (block.type === 'section' || block.type === 'list') {
      return { ...block, children: mapBlocks(block.children, key, change, path) };
    }
    return block;
  });
}

/** Whether the block holds text a person types into. */
export function isTextBlock(block: Block): block is Extract<Block, { type: 'heading' | 'paragraph' }> {
  return block.type === 'heading' || block.type === 'paragraph';
}

/**
 * Set a block's text. A narrative block carrying AI text (`aiText`) becomes a paragraph holding the
 * edited text: the saved tree has no field for model output, so the edit is what gets stored, and
 * the returned `diff` records what the model wrote.
 */
export function editBlockText(
  blocks: readonly Block[],
  key: string,
  text: string,
  aiText?: string,
): EditResult {
  let diff: EditDiff | undefined;
  const next = mapBlocks(blocks, key, (block) => {
    if (block.type === 'narrative' && aiText !== undefined) {
      if (text !== aiText) diff = { blockKey: key, before: aiText, after: text };
      return { type: 'paragraph', ...(block.id === undefined ? {} : { id: block.id }), text };
    }
    if (block.type === 'paragraph') return { ...block, text };
    if (block.type === 'heading') return { ...block, text: text === '' ? block.text : text };
    return block;
  });
  return diff === undefined ? { blocks: next } : { blocks: next, diff };
}

/**
 * Put a fact's value into the draft: at the end of the text block `key`, or, when that block holds
 * no text (a slot, say), as a new paragraph right after it.
 */
export function insertFact(blocks: readonly Block[], key: string, value: string): Block[] {
  const target = keyedBlocks(blocks).find((entry) => entry.key === key)?.block;
  if (target !== undefined && target.type === 'paragraph') {
    const joined = target.text === '' || /\s$/.test(target.text) ? target.text : `${target.text} `;
    return mapBlocks(blocks, key, () => ({ ...target, text: `${joined}${value}` }));
  }
  const fresh: Block = { type: 'paragraph', text: value };
  return insertAfter(blocks, key, fresh);
}

function insertAfter(blocks: readonly Block[], key: string, fresh: Block, prefix = 'b'): Block[] {
  const out: Block[] = [];
  blocks.forEach((block, index) => {
    const path = `${prefix}.${String(index)}`;
    const isTarget = (block.id ?? path) === key;
    if (!isTarget && (block.type === 'section' || block.type === 'list')) {
      out.push({ ...block, children: insertAfter(block.children, key, fresh, path) });
    } else {
      out.push(block);
    }
    if (isTarget) out.push(fresh);
  });
  return out;
}

export interface TextPart {
  text: string;
  missing: boolean;
}

/** Split text around `[[missing: …]]` markers so the editor can warn on them. */
export function splitMissing(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(MISSING)) {
    const at = match.index;
    if (at > last) parts.push({ text: text.slice(last, at), missing: false });
    parts.push({ text: match[0], missing: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), missing: false });
  return parts;
}

export const hasMissing = (text: string): boolean => new RegExp(MISSING.source).test(text);

/** A place `[` and `]` can jump to. */
export interface Finding {
  key: string;
}

/** Wrap-around move through the findings; `-1` means none yet. */
export function stepFinding(count: number, current: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

/** What a block shows as one line in a diff. */
export function blockLine(block: Block): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.text;
    case 'slot':
      return `{{${block.label ?? block.resolver}}}`;
    case 'narrative':
      return `[AI] ${block.prompt}`;
    case 'section':
      return block.title ?? '';
    case 'page_break':
      return '---';
    case 'list':
      return '';
  }
}

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Line diff (longest common subsequence) from the `from` tree to the `to` tree. */
export function diffBlocks(from: readonly Block[], to: readonly Block[]): DiffLine[] {
  const a = keyedBlocks(from).map((e) => blockLine(e.block)).filter((l) => l !== '');
  const b = keyedBlocks(to).map((e) => blockLine(e.block)).filter((l) => l !== '');
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      (table[i] as number[])[j] =
        a[i] === b[j]
          ? ((table[i + 1] as number[])[j + 1] as number) + 1
          : Math.max(
              (table[i + 1] as number[])[j] as number,
              (table[i] as number[])[j + 1] as number,
            );
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] as string });
      i++;
      j++;
    } else if (((table[i + 1] as number[])[j] as number) >= ((table[i] as number[])[j + 1] as number)) {
      out.push({ kind: 'removed', text: a[i++] as string });
    } else {
      out.push({ kind: 'added', text: b[j++] as string });
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] as string });
  while (j < b.length) out.push({ kind: 'added', text: b[j++] as string });
  return out;
}

export const hasChanges = (lines: readonly DiffLine[]): boolean =>
  lines.some((line) => line.kind !== 'same');
