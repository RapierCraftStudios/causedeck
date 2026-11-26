// @vitest-environment jsdom
// #1191 repro and regression: a bulk-imported judgment's stored source URL is an archive member
// (`….tar#member.pdf`) that no browser opens. Every source link in the copilot and the drafting
// studio must open the in-app reader instead (`/w/<slug>/research/judgments/<id>?page=N&para=M#cited`)
// and no rendered href may contain `.tar#`. Clicking a copilot citation lands on the right page with
// the cited paragraph marked and anchored (`#cited`).
import type { CopilotAnswer } from '@causedeck/core/copilot';
import { cleanup, render, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SourcesList } from '../components/copilot/copilot-answer.tsx';
import { AuthorityDrawer } from '../components/drafting/authority-drawer.tsx';
import { CitationPanel } from '../components/drafting/citation-panel.tsx';
import { isBrowsableSourceUrl, judgmentHref, slugOf } from '../lib/judgment-href.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const reader = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'demo' }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(testWorkspaceContext('demo', 'advocate')),
}));
vi.mock('@causedeck/core', () => ({ getJudgmentForReader: reader.get }));

const { default: ReaderPage } =
  await import('../app/(app)/w/[slug]/research/judgments/[id]/page.tsx');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const JUDGMENT = '00000000-0000-4000-8000-0000000e0001';
const TAR = 'https://open-data.example/mhc/2026.tar#2026_mhc_1.pdf';

const withIntl = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const hrefs = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');

const ANSWER: CopilotAnswer = {
  claims: [
    {
      statement: 'Consent was never obtained.',
      sourceId: 'seg:s1',
      kind: 'seg',
      quote: 'no written consent was taken',
      pinpoint: { page: 4, paragraph: 12 },
      documentId: null,
      judgmentId: JUDGMENT,
    },
  ],
  unsupported: [],
  answerText: 'Consent was never obtained.',
  answer: 'Consent was never obtained. [1]',
  noAuthority: false,
  judgments: {
    [JUDGMENT]: {
      id: JUDGMENT,
      title: 'Rao v. Nursing Home',
      court: 'MHC',
      neutralCitation: '2026:MHC:1',
      sourceUrl: TAR,
    },
  },
  aiBlocked: false,
  usage: { used: 1, limit: 30 },
};

describe('no tar links', () => {
  it('copilot source links open the reader at the pinpoint page and paragraph', () => {
    const { container } = withIntl(<SourcesList answer={ANSWER} active={null} />);
    expect(hrefs(container).some((h) => h.includes('.tar'))).toBe(false);
    const link = within(container).getByRole('link', { name: /2026:MHC:1|Rao v\. Nursing Home/ });
    expect(link.getAttribute('href')).toBe(
      `/w/demo/research/judgments/${JUDGMENT}?page=4&para=12#cited`,
    );
    expect(link.getAttribute('target')).toBeNull();
  });

  it('the studio authority drawer opens the reader, never the archive URL', () => {
    const { container } = withIntl(
      <AuthorityDrawer
        status="ready"
        hasBlock
        candidates={[
          {
            candidateRef: { judgmentId: JUDGMENT, quote: 'no written consent was taken', para: 12 },
            title: 'Rao v. Nursing Home',
            neutralCitation: '2026:MHC:1',
            court: 'MHC',
            sourceUrl: TAR,
            page: 4,
            paragraph: 12,
          },
        ]}
        onPropose={vi.fn()}
        onInsert={vi.fn()}
      />,
    );
    expect(hrefs(container).some((h) => h.includes('.tar'))).toBe(false);
    expect(hrefs(container)).toContain(
      `/w/demo/research/judgments/${JUDGMENT}?page=4&para=12#cited`,
    );
  });

  it('the citation panel links a known judgment to the reader and never links an archive URL', () => {
    const { container } = withIntl(
      <CitationPanel
        citations={[
          {
            id: '1',
            blockId: 'b1',
            raw: '2026:MHC:1',
            status: 'verified',
            sourceUrl: TAR,
            judgmentId: JUDGMENT,
            page: 4,
            acknowledged: false,
          },
          {
            id: '2',
            blockId: 'b1',
            raw: '2026:MHC:2',
            status: 'unknown',
            sourceUrl: TAR,
            page: 2,
            acknowledged: false,
          },
        ]}
        onCheck={vi.fn()}
        onJump={vi.fn()}
        onAcknowledge={vi.fn()}
      />,
    );
    expect(hrefs(container)).toEqual([`/w/demo/research/judgments/${JUDGMENT}?page=4#cited`]);
  });
});

describe('judgment-href', () => {
  it('builds the reader URL with only the known pinpoint parts', () => {
    expect(judgmentHref('demo', 'j1')).toBe('/w/demo/research/judgments/j1');
    expect(judgmentHref('demo', 'j1', { page: 3 })).toBe(
      '/w/demo/research/judgments/j1?page=3#cited',
    );
    expect(judgmentHref('a b', 'j1', { page: 0, para: 5 })).toBe(
      '/w/a%20b/research/judgments/j1?para=5#cited',
    );
    expect(judgmentHref('demo', 'j1', { page: null, para: 1.5 })).toBe(
      '/w/demo/research/judgments/j1',
    );
  });

  it('reads the slug from route params', () => {
    expect(slugOf({ slug: 'demo' })).toBe('demo');
    expect(slugOf({ slug: ['x'] })).toBeNull();
    expect(slugOf(null)).toBeNull();
  });

  it('treats archive members and non-http URLs as not browsable, plain PDFs as browsable', () => {
    expect(isBrowsableSourceUrl(TAR)).toBe(false);
    expect(isBrowsableSourceUrl('https://x.example/a.zip')).toBe(false);
    expect(isBrowsableSourceUrl('javascript:alert(1)')).toBe(false);
    expect(isBrowsableSourceUrl('not a url')).toBe(false);
    expect(isBrowsableSourceUrl(undefined)).toBe(false);
    expect(isBrowsableSourceUrl('https://court.example/j1.pdf')).toBe(true);
    expect(isBrowsableSourceUrl('https://court.example/tar/j1.pdf')).toBe(true);
  });
});

describe('copilot citation click lands on the cited page and paragraph', () => {
  it('the reader at the link query marks paragraph 12 on page 4 with the cited anchor', async () => {
    reader.get.mockResolvedValue({
      id: JUDGMENT,
      title: 'Rao v. Nursing Home',
      titleMasked: false,
      neutralCitation: '2026:MHC:1',
      caseNumbers: [],
      court: 'MHC',
      courtLevel: null,
      judgmentDate: '2026-03-04',
      bench: [],
      hasPdf: false,
      pages: [
        { pageNo: 3, paragraphs: [{ number: 12, text: '12. Not this one (page 3).' }] },
        {
          pageNo: 4,
          paragraphs: [
            { number: 11, text: '11. Before.' },
            { number: 12, text: '12. No written consent was taken.' },
          ],
        },
      ],
    });
    const copilot = withIntl(<SourcesList answer={ANSWER} active={null} />);
    const href =
      within(copilot.container)
        .getByRole('link', { name: /2026:MHC:1|Rao v\. Nursing Home/ })
        .getAttribute('href') ?? '';
    cleanup();
    const url = new URL(href, 'https://app.example');
    expect(url.hash).toBe('#cited');
    const id = url.pathname.split('/').at(-1) ?? '';
    const { container } = withIntl(
      await ReaderPage({
        params: Promise.resolve({ slug: 'demo', id }),
        searchParams: Promise.resolve(Object.fromEntries(url.searchParams)),
      }),
    );
    expect(reader.get).toHaveBeenCalledWith(JUDGMENT);
    const cited = container.querySelector('#cited');
    expect(cited?.getAttribute('data-slot')).toBe('reader-cited');
    expect(cited?.textContent).toContain('12. No written consent was taken.');
    expect(cited?.closest('[data-slot="reader-page"]')?.getAttribute('data-page')).toBe('4');
    expect(container.querySelectorAll('#cited')).toHaveLength(1);
  });
});
