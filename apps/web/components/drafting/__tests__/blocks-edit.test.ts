import type { Block } from '@causedeck/validators/drafting';
import { describe, expect, it } from 'vitest';

import {
  diffBlocks,
  editBlockText,
  hasChanges,
  insertFact,
  keyedBlocks,
  splitMissing,
  stepFinding,
} from '../../../lib/drafting/blocks-edit.ts';

const tree: Block[] = [
  { type: 'heading', id: 'h', level: 1, text: 'Petition' },
  { type: 'section', children: [{ type: 'paragraph', text: 'Facts.' }, { type: 'slot', id: 's', resolver: 'matter.cnr' }] },
  { type: 'narrative', id: 'n', prompt: 'Summarise', maxChars: 500 },
];

describe('keyedBlocks', () => {
  it('uses ids, else the position path, including children', () => {
    expect(keyedBlocks(tree).map((e) => e.key)).toEqual(['h', 'b.1', 'b.1.0', 's', 'n']);
  });
});

describe('editBlockText', () => {
  it('edits a paragraph in a nested section', () => {
    const { blocks, diff } = editBlockText(tree, 'b.1.0', 'Facts, amended.');
    expect(keyedBlocks(blocks).find((e) => e.key === 'b.1.0')?.block).toEqual({
      type: 'paragraph',
      text: 'Facts, amended.',
    });
    expect(diff).toBeUndefined();
  });

  it('turns edited AI text into a paragraph and records the diff', () => {
    const { blocks, diff } = editBlockText(tree, 'n', 'My version', 'Model version');
    expect(blocks[2]).toEqual({ type: 'paragraph', id: 'n', text: 'My version' });
    expect(diff).toEqual({ blockKey: 'n', before: 'Model version', after: 'My version' });
    expect(tree[2]?.type).toBe('narrative');
  });

  it('records no diff when the AI text is unchanged', () => {
    expect(editBlockText(tree, 'n', 'Same', 'Same').diff).toBeUndefined();
  });
});

describe('insertFact', () => {
  it('appends to a paragraph with a space', () => {
    const next = insertFact(tree, 'b.1.0', 'WP 12/2025');
    expect(keyedBlocks(next).find((e) => e.key === 'b.1.0')?.block).toEqual({
      type: 'paragraph',
      text: 'Facts. WP 12/2025',
    });
  });

  it('adds a paragraph after a slot', () => {
    const next = insertFact(tree, 's', 'WP 12/2025');
    const section = next[1];
    expect(section?.type === 'section' && section.children[2]).toEqual({
      type: 'paragraph',
      text: 'WP 12/2025',
    });
  });
});

describe('splitMissing and findings', () => {
  it('marks missing markers', () => {
    expect(splitMissing('Case [[missing: matter.cnr]] filed')).toEqual([
      { text: 'Case ', missing: false },
      { text: '[[missing: matter.cnr]]', missing: true },
      { text: ' filed', missing: false },
    ]);
  });

  it('steps with wrap-around', () => {
    expect(stepFinding(0, -1, 1)).toBe(-1);
    expect(stepFinding(3, -1, 1)).toBe(0);
    expect(stepFinding(3, -1, -1)).toBe(2);
    expect(stepFinding(3, 2, 1)).toBe(0);
    expect(stepFinding(3, 0, -1)).toBe(2);
  });
});

describe('diffBlocks', () => {
  it('reports added and removed lines', () => {
    const to = editBlockText(tree, 'b.1.0', 'Changed.').blocks;
    const lines = diffBlocks(tree, to);
    expect(lines).toContainEqual({ kind: 'removed', text: 'Facts.' });
    expect(lines).toContainEqual({ kind: 'added', text: 'Changed.' });
    expect(hasChanges(diffBlocks(tree, tree))).toBe(false);
  });
});
