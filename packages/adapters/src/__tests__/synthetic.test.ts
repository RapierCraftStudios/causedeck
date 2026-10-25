// Seeded synthetic generators (#371): reproducible per seed, flagged FICTIONAL, and a pdf-lib
// list that round-trips through the PDF layout reader into rows anchored verbatim on their page;
// positioned runs (#408) keep their x, so table cells start at their column.
import { describe, expect, it } from 'vitest';

import { createEchoAdapter, ECHO_FORUM_CODE, layoutFromPdf } from '../index.ts';
import {
  mulberry32,
  syntheticEchoList,
  writeSyntheticColumnPdf,
  writeSyntheticPdf,
} from '../testing/synthetic.ts';

const take = (next: () => number, count: number) => Array.from({ length: count }, () => next());

describe('mulberry32', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const first = take(mulberry32(371), 5);
    expect(take(mulberry32(371), 5)).toEqual(first);
    expect(take(mulberry32(372), 5)).not.toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('syntheticEchoList', () => {
  it('is byte-identical for a seed, flagged FICTIONAL and synthetic', async () => {
    const list = syntheticEchoList({ pages: 3, rowsPerPage: 4, seed: 7 });
    expect(syntheticEchoList({ pages: 3, rowsPerPage: 4, seed: 7 }).text).toBe(list.text);
    expect(syntheticEchoList({ pages: 3, rowsPerPage: 4, seed: 8 }).text).not.toBe(list.text);
    expect(list.manifestEntry).toEqual({ origin: 'synthetic', classification: 'FICTIONAL' });
    expect(list.text.split('\f')).toHaveLength(3);

    const parsed = await createEchoAdapter().parseCauseList({
      kind: 'text',
      text: list.text,
      meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: ECHO_FORUM_CODE },
    });
    expect(parsed.rows).toHaveLength(12);
    expect(parsed.diagnostics.rowsSkippedNoAnchor).toBe(0);
  });
});

describe('writeSyntheticPdf', () => {
  const pages = [
    [
      'ECHO TEST COURT (FICTIONAL)',
      'CAUSE LIST FOR 21.10.2026',
      'COURT HALL 1',
      'FOR ADMISSION',
      '1. W.P. No. 101 of 2026 Fictional Party vs Pretend Respondent',
      '2. W.A. No. 202 of 2026 Imaginary Trader vs Fictional Collector',
    ],
    [
      'COURT HALL 2',
      'FOR ORDERS',
      '3. C.M.A. No. 303 of 2026 Made-up Farmer vs Pretend Respondent',
    ],
  ];

  it('writes the same bytes for the same pages', async () => {
    expect(await writeSyntheticPdf(pages)).toEqual(await writeSyntheticPdf(pages));
  });

  it('round-trips through layoutFromPdf into rows anchored verbatim on their page', async () => {
    const layout = await layoutFromPdf(await writeSyntheticPdf(pages));
    expect(layout.pages).toHaveLength(2);
    const parsed = await createEchoAdapter().parseCauseList({
      kind: 'layout',
      layout,
      meta: { receivedAt: '2026-10-21T04:00:00.000Z', forumCode: ECHO_FORUM_CODE },
    });
    expect(parsed.rows.map((row) => [row.hallNo, row.matchKey])).toEqual([
      ['1', 'WP/101/2026'],
      ['1', 'WA/202/2026'],
      ['2', 'CMA/303/2026'],
    ]);
    for (const row of parsed.rows) {
      expect(layout.pages[row.anchor.page - 1]?.text).toContain(row.anchor.quote);
      expect(row.anchor.bbox).toBeDefined();
    }
  });
});

describe('writeSyntheticColumnPdf (#408)', () => {
  const pages = [
    [
      { x: 40, y: 60, text: 'COURT HALL NO. 1 (FICTIONAL)' },
      { x: 40, y: 80, text: 'Sl. No.' },
      { x: 80, y: 80, text: 'Case No.' },
      { x: 220, y: 80, text: 'Petitioner / Respondent' },
    ],
    [
      { x: 44, y: 100, text: '1' },
      { x: 78, y: 100, text: 'WP No. 101/2026', size: 8 },
      { x: 220, y: 100, text: 'Fictional Party vs Pretend State' },
    ],
  ];

  it('writes the same bytes for the same runs', async () => {
    expect(await writeSyntheticColumnPdf(pages)).toEqual(await writeSyntheticColumnPdf(pages));
  });

  it('keeps every run at its x on its page, one line per baseline', async () => {
    const layout = await layoutFromPdf(await writeSyntheticColumnPdf(pages));
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0]?.text.split('\n')).toEqual([
      'COURT HALL NO. 1 (FICTIONAL)',
      'Sl. No. Case No. Petitioner / Respondent',
    ]);
    pages.forEach((runs, index) => {
      const words = layout.pages[index]?.words ?? [];
      for (const run of runs) {
        const first = words.find((word) => word.text === run.text.split(' ')[0]);
        expect(Math.abs((first?.bbox.x ?? -10) - run.x), run.text).toBeLessThanOrEqual(1);
      }
    });
  });
});
