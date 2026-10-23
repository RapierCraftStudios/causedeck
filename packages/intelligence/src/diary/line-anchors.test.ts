import { describe, expect, it } from 'vitest';

import { normaliseLines, toAnchorBbox } from '../ocr/line-boxes.ts';

import { must } from './fixtures.ts';
import { anchorKey, anchorOf, anchorRow, numberLines } from './line-anchors.ts';

describe('line anchors', () => {
  const lines = normaliseLines([
    { text: ' second ', bbox: [0.1, 0.4, 0.9, 0.5], conf: 0.8 },
    { text: 'first', bbox: [0.1, 0.1, 0.9, 0.2], conf: 0.9 },
    { text: 'bad box', bbox: [0.9, 0.1, 0.1, 0.2], conf: 0.9 },
    { text: '  ', bbox: [0.1, 0.1, 0.2, 0.2], conf: 0.9 },
  ]);

  it('keeps valid boxes in reading order', () => {
    expect(lines.map((l) => l.text)).toEqual(['first', 'second']);
  });

  it('numbers lines across pages and builds image_region anchor rows', () => {
    const numbered = numberLines([
      { page: 2, text: '', confidence: null, lines: [must(lines[0])] },
      { page: 1, text: '', confidence: null, lines: [must(lines[1])] },
    ]);
    expect(numbered.map((l) => [l.n, l.page])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const row = anchorRow(anchorOf(must(numbered[1])));
    expect(row).toMatchObject({ pageNo: 2, kind: 'image_region', quote: 'first' });
    expect(row.bbox).toEqual(toAnchorBbox([0.1, 0.1, 0.9, 0.2]));
    expect(anchorKey(anchorOf(must(numbered[0])))).toBe('1:0.1,0.4,0.9,0.5');
  });
});
