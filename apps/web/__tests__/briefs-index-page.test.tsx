// @vitest-environment jsdom
// The briefs index (`/w/[slug]/briefs`): listings of the next three court days link to their Brief
// Sheet, an empty window points at the calendar, and a role without `listing.read` is denied.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const state = vi.hoisted((): { context: WorkspaceContext | null } => ({ context: null }));
const courtDay = vi.hoisted(() => ({ getCourtDay: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/w/demo/briefs',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getLocale: () => Promise.resolve('en'),
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(state.context),
}));
vi.mock('../components/help/surface-help.tsx', () => ({ SurfaceHelp: () => null }));
vi.mock('@causedeck/core/runtime', () => ({ db: {} }));
vi.mock('@causedeck/core/court-day', () => courtDay);

const { default: BriefsPage } = await import('../app/(app)/w/[slug]/briefs/page.tsx');

const en = catalogs.en.brief.index;
const LISTING = '11111111-1111-4111-8111-111111111111';
const day = (items: unknown[]) => ({
  complexes: items.length
    ? [{ forumId: 'f', name: 'Madras High Court', halls: [{ hallNo: '12', lists: [{ items }] }] }]
    : [],
});
const item = {
  listingId: LISTING,
  matterTitle: 'Rao v State',
  caseLabel: 'WP 1/2026',
  stageRaw: 'For hearing',
  itemNo: '7',
};

const props = { params: Promise.resolve({ slug: 'demo' }), searchParams: Promise.resolve({}) };
const mount = async () =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {(await BriefsPage(props)) as ReactElement}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  state.context = testWorkspaceContext('demo', 'advocate');
  courtDay.getCourtDay.mockReset();
});
afterEach(cleanup);

describe('briefs index', () => {
  it('lists the next three days and links each listing to its brief', async () => {
    courtDay.getCourtDay
      .mockResolvedValueOnce(day([item]))
      .mockResolvedValueOnce(day([]))
      .mockResolvedValueOnce(day([]));
    await mount();
    expect(courtDay.getCourtDay).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    const link = screen.getByRole('link', { name: /Rao v State/ });
    expect(link.getAttribute('href')).toBe(`/w/demo/briefs/${LISTING}`);
    expect(screen.getAllByText(en.noListings)).toHaveLength(2);
  });

  it('shows an empty state with a calendar link when nothing is listed', async () => {
    courtDay.getCourtDay.mockResolvedValue(day([]));
    await mount();
    expect(document.querySelector('[data-pattern-state="empty"]')?.textContent).toContain(
      en.allEmpty,
    );
    expect(screen.getByRole('link', { name: en.openCalendar }).getAttribute('href')).toBe(
      '/w/demo/calendar',
    );
  });

  it('refuses a non-member workspace', async () => {
    state.context = null;
    await expect(BriefsPage(props)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
