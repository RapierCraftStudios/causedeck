// @vitest-environment jsdom
// Matters list page (#388, #40 part 2): rows from `searchMatters` in the member's workspace scope
// with title, `Petitioner v. Respondent`, forum, stage badge, proceeding count, the canonical next
// date with `Confirmed` / `To confirm`, owner and updated time, and the `Sensitive` lock badge. The
// URL drives every filter, the search, the sort and the keyset cursor (50 per page). `New matter`
// exists only for members with `matter.write`. States: empty, filtered-empty, error, offline,
// permission-denied, and the dev `__state` previews; the loading and error boundaries too.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatterListPage, MatterListRow, NextDateSummary } from '@causedeck/core/matter-graph';
import { MATTER_STATUSES } from '@causedeck/validators/matter-graph';
import { MATTER_SORTS } from '@causedeck/validators/matter-graph-inputs';

import {
  MATTER_LIST_SORTS,
  MATTER_LIST_STATUSES,
  matterListHref,
  parseMatterListParams,
  parseMatterListState,
} from '../lib/matters/list-params.ts';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const FORUM_ID = '00000000-0000-4000-8000-0000000000f1';
const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  result: null as MatterListPage | null,
  error: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
  listMembersIn: vi.fn(() =>
    Promise.resolve([{ memberId: '00000000-0000-4000-8000-0000000000a1', name: 'Asha Rao' }]),
  ),
}));
const graph = vi.hoisted(() => ({
  searchMatters: vi.fn(() =>
    page.error === null ? Promise.resolve(page.result) : Promise.reject(page.error),
  ),
}));
const court = vi.hoisted(() => ({
  getCourtsIndex: vi.fn(() =>
    Promise.resolve({
      cities: [
        {
          city: 'Chennai',
          courts: [
            {
              court: 'Madras High Court',
              forums: [
                {
                  id: '00000000-0000-4000-8000-0000000000f1',
                  court: 'Madras High Court',
                  seat: 'Chennai',
                },
              ],
            },
          ],
        },
      ],
      disabled: [],
    }),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`);
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
  getLocale: () => Promise.resolve('en'),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/matter-graph', () => graph);
vi.mock('@causedeck/core/court', () => court);
vi.mock('../app/(app)/w/[slug]/matters/actions.ts', () => ({
  createMatterAction: vi.fn(),
  searchMattersAction: vi.fn(),
}));

// The page loads the list and the filter options at once, so their dynamic imports of core run
// concurrently; warm the mocked modules one after another first, or the second import bypasses
// vi.mock (it resolves the real core module).
await import('@causedeck/core/runtime');
await import('@causedeck/core/matter-graph');
await import('@causedeck/core/court');
const { default: MattersPage } = await import('../app/(app)/w/[slug]/matters/page.tsx');
const { default: MattersLoading } = await import('../app/(app)/w/[slug]/matters/loading.tsx');
const { default: MattersError } = await import('../app/(app)/w/[slug]/matters/error.tsx');

const en = catalogs.en.matters;

function row(overrides: Partial<MatterListRow> = {}): MatterListRow {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Rao v. State of Tamil Nadu',
    status: 'active',
    sensitive: false,
    petitioner: 'K. Rao',
    respondent: 'State of Tamil Nadu',
    forum: { id: FORUM_ID, court: 'Madras High Court', establishment: null, seat: 'Chennai' },
    stage: 'listed',
    proceedingCount: 3,
    nextDate: {
      date: '2026-11-14',
      proceedingId: '00000000-0000-4000-8000-0000000000b1',
      listingId: '00000000-0000-4000-8000-0000000000c1',
      sourceType: 'cause_list',
      confirmationState: 'confirmed',
    },
    owner: { memberId: OWNER_ID, userId: 'user-1', name: 'Asha Rao' },
    updatedAt: new Date('2026-10-20T06:30:00Z'),
    ...overrides,
  } as MatterListRow;
}

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const props = (query: Record<string, string> = {}) => ({
  params: Promise.resolve({ slug: 'demo' }),
  searchParams: Promise.resolve(query),
});

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(readonly code: string) {
    super(code);
  }
}

const table = () => document.querySelector('[data-matters-layout="table"]') as HTMLElement;

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.result = { items: [row()], nextCursor: null };
  page.error = null;
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('matters list URL contract (#388)', () => {
  it('keeps its status and sort lists in step with the validators', () => {
    expect([...MATTER_LIST_STATUSES]).toEqual([...MATTER_STATUSES]);
    expect([...MATTER_LIST_SORTS]).toEqual([...MATTER_SORTS]);
  });

  it('maps every URL param to the searchMatters input, 50 per page', () => {
    expect(
      parseMatterListParams({
        status: 'disposed',
        forum: FORUM_ID,
        owner: OWNER_ID,
        noNextDate: '1',
        sensitive: '1',
        q: '  wp 45/26 ',
        sort: 'title',
        cursor: 'abc',
      }),
    ).toEqual({
      status: 'disposed',
      forumId: FORUM_ID,
      ownerMemberId: OWNER_ID,
      noNextDate: true,
      sensitive: true,
      q: 'wp 45/26',
      sort: 'title',
      limit: 50,
      cursor: 'abc',
    });
    expect(parseMatterListParams({})).toEqual({ sort: 'next_date', limit: 50 });
  });

  it('drops malformed values instead of failing', () => {
    expect(
      parseMatterListState({
        status: 'open',
        forum: 'not-a-uuid',
        owner: ['x'],
        noNextDate: 'yes',
        q: '   ',
        sort: 'random',
        cursor: '',
      }),
    ).toEqual({ sort: 'next_date' });
  });

  it('drops the cursor on any change but paging, and leaves defaults out of the URL', () => {
    const state = parseMatterListState({ q: 'rao', cursor: 'c1', sort: 'updated' });
    expect(matterListHref('demo', state, { status: 'active' })).toBe(
      '/w/demo/matters?q=rao&status=active&sort=updated',
    );
    expect(matterListHref('demo', state, { cursor: 'c2' })).toBe(
      '/w/demo/matters?q=rao&sort=updated&cursor=c2',
    );
    expect(matterListHref('demo', state, { sort: 'next_date', q: undefined })).toBe(
      '/w/demo/matters',
    );
  });
});

describe('matters page (#388)', () => {
  it('shows each row’s title, parties, forum, stage, count, next date, owner and update', async () => {
    withIntl(await MattersPage(props()));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    const rows = table().querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    const text = rows[0]?.textContent ?? '';
    expect(text).toContain('Rao v. State of Tamil Nadu');
    expect(text).toContain('K. Rao v. State of Tamil Nadu');
    expect(text).toContain('Madras High Court');
    expect(text).toContain('Sat, 14 Nov 2026');
    expect(text).toContain(en.nextDate.confirmed);
    expect(text).toContain('Asha Rao');
    expect(text).toContain('20 Oct 2026');
    expect(rows[0]?.querySelector('[data-stage="listed"]')).not.toBeNull();
    expect(rows[0]?.querySelectorAll('td')[3]?.textContent).toBe('3');
    expect(
      screen.getAllByRole('link', {
        name: 'Open matter Rao v. State of Tamil Nadu, next date Sat, 14 Nov 2026',
      }),
    ).toHaveLength(2);
    expect(runtime.inWorkspace).toHaveBeenCalledWith(
      { workspaceId: 'ws-1', userId: 'user-1' },
      expect.any(Function),
    );
    expect(graph.searchMatters).toHaveBeenCalledWith(
      expect.objectContaining({ db: { tx: true } }),
      { workspaceId: 'ws-1', userId: 'user-1' },
      { sort: 'next_date', limit: 50 },
    );
  });

  it('marks a proposed date `To confirm`, a missing one `No next date`, and sensitive matters', async () => {
    page.result = {
      items: [
        row({
          id: '00000000-0000-4000-8000-000000000002',
          sensitive: true,
          nextDate: { ...(row().nextDate as NextDateSummary), confirmationState: 'proposed' },
        }),
        row({ id: '00000000-0000-4000-8000-000000000003', nextDate: null, stage: 'For orders' }),
      ],
      nextCursor: null,
    };
    withIntl(await MattersPage(props()));
    const [first, second] = table().querySelectorAll('tbody tr');
    expect(first?.textContent).toContain(en.nextDate.toConfirm);
    expect(first?.querySelector('[data-matter-sensitive]')?.textContent).toBe(en.sensitive);
    expect(first?.querySelector('[data-matter-sensitive] svg')).not.toBeNull();
    expect(second?.textContent).toContain(en.nextDate.none);
    expect(second?.querySelector('[data-matter-sensitive]')).toBeNull();
    // A stage the badge does not know is printed as it was listed.
    expect(second?.querySelector('[data-stage]')).toBeNull();
    expect(second?.textContent).toContain('For orders');
    // The cards show the badge too.
    const cards = document.querySelector('[data-matters-layout="cards"]');
    expect(cards?.querySelectorAll('[data-matter-sensitive]')).toHaveLength(1);
  });

  it('passes every filter, the search, the sort and the cursor to searchMatters', async () => {
    withIntl(
      await MattersPage(
        props({
          status: 'active',
          forum: FORUM_ID,
          owner: OWNER_ID,
          noNextDate: '1',
          sensitive: '1',
          q: 'W.P. No. 45 of 2026',
          sort: 'updated',
          cursor: 'k1',
        }),
      ),
    );
    expect(graph.searchMatters).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      status: 'active',
      forumId: FORUM_ID,
      ownerMemberId: OWNER_ID,
      noNextDate: true,
      sensitive: true,
      q: 'W.P. No. 45 of 2026',
      sort: 'updated',
      limit: 50,
      cursor: 'k1',
    });
    expect(screen.getByRole('searchbox', { name: en.search.label })).toHaveProperty(
      'value',
      'W.P. No. 45 of 2026',
    );
    expect(document.querySelector('[data-matter-sort="updated"]')?.closest('th')).toHaveProperty(
      'ariaSort',
      'descending',
    );
  });

  it('links the next 50 only when there is another page, and the first page from a later one', async () => {
    withIntl(await MattersPage(props()));
    expect(document.querySelector('[data-matters-page]')).toBeNull();
    cleanup();
    page.result = { items: [row()], nextCursor: 'next-1' };
    withIntl(await MattersPage(props({ sort: 'title', cursor: 'k1' })));
    expect(document.querySelector('[data-matters-page="next"]')?.getAttribute('href')).toBe(
      '/w/demo/matters?sort=title&cursor=next-1',
    );
    expect(document.querySelector('[data-matters-page="first"]')?.getAttribute('href')).toBe(
      '/w/demo/matters?sort=title',
    );
  });

  it('redirects a cursor the list refuses back to the first page', async () => {
    page.error = new WorkspaceError('VALIDATION');
    await expect(MattersPage(props({ sort: 'title', cursor: 'from-next-date' }))).rejects.toThrow(
      'NEXT_REDIRECT /w/demo/matters?sort=title',
    );
  });

  it('shows the empty state with New matter and Open Inbox', async () => {
    page.result = { items: [], nextCursor: null };
    withIntl(await MattersPage(props()));
    const empty = document.querySelector('[data-pattern-state="empty"]');
    expect(empty?.textContent).toContain(en.empty.title);
    expect(empty?.textContent).toContain(en.empty.body);
    expect(screen.getByRole('button', { name: en.new.trigger })).toBeTruthy();
    expect(screen.getByRole('link', { name: en.empty.openInbox }).getAttribute('href')).toBe(
      '/w/demo/inbox',
    );
  });

  it('says nothing matches when filters are on, with Clear filters', async () => {
    page.result = { items: [], nextCursor: null };
    withIntl(await MattersPage(props({ status: 'archived', sort: 'title' })));
    const empty = document.querySelector('[data-matters-empty="filtered"]');
    expect(empty?.textContent).toContain(en.filteredEmpty.title);
    expect(
      screen.getAllByRole('link', { name: en.filteredEmpty.clear })[0]?.getAttribute('href'),
    ).toBe('/w/demo/matters?sort=title');
  });

  it.each([
    ['owner', true],
    ['advocate', true],
    ['junior', true],
    ['clerk', false],
    ['viewer', false],
  ] satisfies [Role, boolean][])('New matter for a %s: %s', async (role, shown) => {
    page.context = testWorkspaceContext('demo', role);
    withIntl(await MattersPage(props()));
    expect(screen.queryByRole('button', { name: en.new.trigger }) !== null).toBe(shown);
    expect(table().querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('renders permission-denied when core refuses access', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    withIntl(await MattersPage(props()));
    const denied = document.querySelector('[data-pattern-state="permission-denied"]');
    expect(denied?.textContent).toContain(en.denied);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('throws to the error boundary when loading fails, logging no party data', async () => {
    page.error = new Error('db down');
    await expect(MattersPage(props({ q: 'Rao' }))).rejects.toThrow('Matters could not be loaded');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls[0]?.[1])).not.toContain('Rao');
  });

  it('shows the offline banner and turns New matter off while offline', async () => {
    setOnline(false);
    withIntl(await MattersPage(props()));
    expect(document.querySelector('[data-matters-offline]')?.textContent).toContain(en.offline);
    expect(screen.getByRole('button', { name: en.new.trigger })).toHaveProperty('disabled', true);
  });

  it('previews loading, error, denied and offline in development only', async () => {
    withIntl(await MattersPage(props({ __state: 'loading' })));
    expect(document.querySelector('[data-slot="matters-skeleton"]')).not.toBeNull();
    cleanup();
    await expect(MattersPage(props({ __state: 'error' }))).rejects.toThrow();
    withIntl(await MattersPage(props({ __state: 'denied' })));
    expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    cleanup();
    withIntl(await MattersPage(props({ __state: 'offline' })));
    expect(document.querySelector('[data-matters-offline]')).not.toBeNull();
    cleanup();
    expect(graph.searchMatters).toHaveBeenCalledTimes(1);
    page.dev = false;
    withIntl(await MattersPage(props({ __state: 'loading' })));
    expect(document.querySelector('[data-slot="matters-skeleton"]')).toBeNull();
    expect(table().querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('never shows a rupee sign', async () => {
    withIntl(await MattersPage(props()));
    expect(document.body.textContent).not.toContain('₹');
  });

  it('is not found without a workspace context', async () => {
    page.context = null;
    await expect(MattersPage(props())).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('matters route boundaries (#388)', () => {
  it('loading.tsx is a labelled skeleton of table rows and cards', () => {
    withIntl(<MattersLoading />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(en.loading);
    expect(document.querySelector('[data-matters-skeleton="table"]')).not.toBeNull();
    expect(document.querySelector('[data-matters-skeleton="cards"]')).not.toBeNull();
  });

  it('error.tsx shows Couldn’t load matters., Retry and the reference, never the message', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('boom secret'), { digest: 'd1' });
    withIntl(<MattersError error={error} reset={reset} />);
    expect(screen.getByText(en.error.title)).toBeTruthy();
    expect(screen.getByText('Reference: d1')).toBeTruthy();
    expect(screen.queryByText(/boom/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(reset).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(error, { boundary: 'route', digest: 'd1' });
  });
});
