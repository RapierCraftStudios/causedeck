// The plain-text layout reader (#370): one page per form feed, line endings normalised.
import { describe, expect, it } from 'vitest';

import { layoutFromText, LayoutDocumentSchema } from '../index.ts';

describe('layoutFromText', () => {
  it('splits pages on form feeds and normalises line endings', () => {
    const layout = layoutFromText('COURT HALL 1\r\nFOR ADMISSION\fCOURT HALL 2\rFOR ORDERS');
    expect(LayoutDocumentSchema.parse(layout)).toEqual(layout);
    expect(layout.pages).toEqual([
      {
        page: 1,
        width: 0,
        height: 0,
        text: 'COURT HALL 1\nFOR ADMISSION',
        items: [],
        words: [],
        textCoverage: 1,
      },
      {
        page: 2,
        width: 0,
        height: 0,
        text: 'COURT HALL 2\nFOR ORDERS',
        items: [],
        words: [],
        textCoverage: 1,
      },
    ]);
  });

  it('gives one empty page with textCoverage 0 for empty input', () => {
    expect(layoutFromText('').pages).toEqual([
      { page: 1, width: 0, height: 0, text: '', items: [], words: [], textCoverage: 0 },
    ]);
    expect(layoutFromText('A\f  \n').pages.map((page) => page.textCoverage)).toEqual([1, 0]);
  });
});
