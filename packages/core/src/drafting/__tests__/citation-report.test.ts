// reportFromRows (#1137): the stored pinpoint and quote check status reach the citation report so the
// studio can link `#page=` and show why a citation is not verified; the quote text never does.
import { CitationReportSchema } from '@causedeck/validators/citation';
import { describe, expect, it } from 'vitest';

import { reportFromRows, type AuthorityRow } from '../citations.ts';

const VERSION = '00000000-0000-4000-8000-000000000001';

function row(over: Partial<AuthorityRow> & Pick<AuthorityRow, 'id' | 'span'>): AuthorityRow {
  return {
    workspaceId: '00000000-0000-4000-8000-000000000002',
    draftVersionId: VERSION,
    blockId: 'b1',
    rawText: '2023 INSC 12',
    normalized: '2023 INSC 12',
    kind: 'neutral',
    resolution: {},
    status: 'verified',
    sourceUrl: null,
    checkedAt: new Date('2026-01-01T00:00:00Z'),
    ackBy: null,
    ackAt: null,
    ...over,
  };
}

describe('reportFromRows', () => {
  it('emits the stored pinpoint and quote check', () => {
    const report = reportFromRows(VERSION, [
      row({
        id: 'a',
        span: [0, 12],
        status: 'unknown',
        sourceUrl: 'https://corpus.example/j/1.pdf',
        resolution: {
          reason: 'quote_not_found',
          pinpoint: { para: 4, page: 7 },
          quote: 'not_found',
        },
      }),
    ]);
    const [item] = report.items;
    expect(item?.pinpoint).toEqual({ para: 4, page: 7 });
    expect(item?.quoteChecked).toBe('not_found');
    expect(item?.reason).toBe('quote_not_found');
    expect(item?.sourceUrl).toBe('https://corpus.example/j/1.pdf');
    expect(CitationReportSchema.safeParse(report).success).toBe(true);
  });

  it('omits pinpoint and quoteChecked when nothing was stored', () => {
    const report = reportFromRows(VERSION, [row({ id: 'b', span: [0, 12] })]);
    const [item] = report.items;
    expect(item).not.toHaveProperty('pinpoint');
    expect(item).not.toHaveProperty('quoteChecked');
    expect(report.counts).toEqual({ verified: 1, not_found: 0, unknown: 0 });
    expect(CitationReportSchema.safeParse(report).success).toBe(true);
  });
});
