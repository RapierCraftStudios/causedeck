import { describe, expect, it, vi } from 'vitest';

import { corpusPoll, pdfLinks, runCorpusPoll } from './corpus-poll.ts';

const log = { info: vi.fn(), warn: vi.fn() } as never;

describe('pdfLinks', () => {
  it('takes same-host PDF links, resolved and deduplicated', () => {
    const html = `<a href="/j/1.pdf">a</a><a href='2.pdf?x=1'>b</a><a href="/j/1.pdf">dup</a>
      <a href="https://other.example/3.pdf">off host</a><a href="/page.html">page</a>`;
    expect(pdfLinks(html, 'https://mhc.example/list/')).toEqual([
      'https://mhc.example/j/1.pdf',
      'https://mhc.example/list/2.pdf',
    ]);
  });
});

describe('runCorpusPoll', () => {
  it('does nothing without a fetcher', async () => {
    const report = await runCorpusPoll({ log }, {}, { fetcher: null });
    expect(report).toEqual({ sources: 0, skipped: 0, inserted: 0, duplicates: 0, failed: 0 });
  });

  it('is a scheduled daily system job', () => {
    expect(corpusPoll.name).toBe('system.corpus.poll');
    expect(corpusPoll.schedule?.cron).toBe('0 5 * * *');
  });
});
