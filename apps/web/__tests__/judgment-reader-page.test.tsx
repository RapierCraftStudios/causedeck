// @vitest-environment jsdom
// The in-app judgment reader (#1191): the citable header (masked title withheld, citation, court,
// date, bench), the anonymised text per page, the cited paragraph marked and anchored (`#cited`), the
// cited page anchored when the paragraph is unknown, "Download PDF" only when the original is stored
// and servable, the not-available state for an absent or unredacted judgment, and a workspace the member is not in.
import type { JudgmentForReader } from '@causedeck/core';
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const state = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  get: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('@causedeck/core', () => ({ getJudgmentForReader: state.get }));

const { default: ReaderPage, generateMetadata } =
  await import('../app/(app)/w/[slug]/research/judgments/[id]/page.tsx');

const en = catalogs.en.research.reader;
const ID = '00000000-0000-4000-8000-0000000e0001';

const JUDGMENT: JudgmentForReader = {
  id: ID,
  title: 'X v. State',
  titleMasked: true,
  neutralCitation: '2026:MHC:7',
  caseNumbers: ['CRL.A. 12/2025'],
  court: 'MHC',
  courtLevel: 'high_court',
  judgmentDate: '2026-03-04',
  bench: ['Justice A', 'Justice B'],
  hasPdf: false,
  pages: [
    { pageNo: 1, paragraphs: [{ number: 1, text: '1. Heard counsel.' }] },
    {
      pageNo: 2,
      paragraphs: [
        { number: 4, text: '4. [A] met [B] at the market.' },
        { number: 5, text: '5. The appeal fails.' },
      ],
    },
  ],
};

const withIntl = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

async function open(query: { page?: string; para?: string } = {}, id = ID) {
  return withIntl(
    await ReaderPage({
      params: Promise.resolve({ slug: 'demo', id }),
      searchParams: Promise.resolve(query),
    }),
  ).container;
}

beforeEach(() => {
  state.context = testWorkspaceContext('demo', 'advocate');
  state.get.mockResolvedValue(JUDGMENT);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('judgment reader page', () => {
  it('shows the citable header with the stored (masked) title and the anonymised pages', async () => {
    const container = await open();
    const header = container.querySelector('[data-slot="reader-header"]');
    expect(header?.querySelector('h1')?.textContent).toBe('X v. State');
    for (const value of [
      '2026:MHC:7',
      'CRL.A. 12/2025',
      'MHC',
      '2026-03-04',
      'Justice A, Justice B',
    ]) {
      expect(header?.textContent).toContain(value);
    }
    expect(header?.textContent).toContain(en.anonymised);
    const pages = container.querySelectorAll('[data-slot="reader-page"]');
    expect(Array.from(pages).map((p) => p.getAttribute('data-page'))).toEqual(['1', '2']);
    expect(container.textContent).toContain('4. [A] met [B] at the market.');
    expect(container.querySelector('#cited')).toBeNull();
    expect(container.querySelector('a[href="/w/demo/research"]')?.textContent).toBe(en.back);
  });

  it('says the title is withheld when it is masked and none is stored', async () => {
    state.get.mockResolvedValue({ ...JUDGMENT, title: null, titleMasked: true });
    expect((await open()).querySelector('h1')?.textContent).toBe(en.maskedTitle);
  });

  it('marks and anchors the cited paragraph on the cited page', async () => {
    const container = await open({ page: '2', para: '5' });
    const cited = container.querySelectorAll('#cited');
    expect(cited).toHaveLength(1);
    expect(cited[0]?.tagName).toBe('MARK');
    expect(cited[0]?.textContent).toContain('5. The appeal fails.');
    expect(cited[0]?.textContent).toContain(en.cited);
    expect(cited[0]?.closest('[data-slot="reader-page"]')?.getAttribute('data-page')).toBe('2');
  });

  it('anchors the cited page when the paragraph is unknown, nothing for a bad query', async () => {
    const container = await open({ page: '2', para: '99' });
    const cited = container.querySelector('#cited');
    expect(cited?.getAttribute('data-slot')).toBe('reader-page');
    expect(cited?.getAttribute('data-page')).toBe('2');
    expect(container.querySelector('mark')).toBeNull();
    cleanup();
    expect((await open({ page: '-1', para: 'x' })).querySelector('#cited')).toBeNull();
  });

  it('finds the paragraph on any page when only the paragraph is given', async () => {
    const cited = (await open({ para: '4' })).querySelector('#cited');
    expect(cited?.textContent).toContain('4. [A] met [B]');
  });

  it('offers Download PDF only when the original is stored and servable', async () => {
    let container = await open();
    expect(container.querySelector('[data-slot="reader-download"]')).toBeNull();
    expect(container.textContent).toContain(en.noPdf);
    cleanup();
    state.get.mockResolvedValue({ ...JUDGMENT, titleMasked: false, hasPdf: true });
    container = await open();
    const download = container.querySelector('[data-slot="reader-download"]');
    expect(download?.getAttribute('href')).toBe(`/api/judgments/${ID}/pdf`);
    expect(download?.textContent).toBe(en.downloadPdf);
  });

  it('shows the not-available state for an absent or unredacted judgment and a bad id', async () => {
    state.get.mockResolvedValue(null);
    const container = await open();
    expect(container.querySelector('[data-slot="reader-not-found"]')?.textContent).toContain(
      en.notFound,
    );
    cleanup();
    state.get.mockClear();
    const bad = await open({}, 'not-a-uuid');
    expect(bad.querySelector('[data-slot="reader-not-found"]')).not.toBeNull();
    expect(state.get).not.toHaveBeenCalled();
  });

  it("is not found outside the member's workspaces", async () => {
    state.context = null;
    await expect(
      ReaderPage({
        params: Promise.resolve({ slug: 'x', id: ID }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.get).not.toHaveBeenCalled();
  });

  it('keeps the page out of search indexes', async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ slug: 'demo', id: ID }),
      searchParams: Promise.resolve({}),
    });
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.title).toBe('X v. State');
  });

  it("keeps the matter's relevant-judgments page out of search indexes too", async () => {
    const { generateMetadata: matterMetadata } =
      await import('../app/(app)/w/[slug]/matters/[id]/research/page.tsx');
    expect((await matterMetadata()).robots).toEqual({ index: false, follow: false });
  });
});
