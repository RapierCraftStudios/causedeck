// @vitest-environment jsdom
// Forum detail routes (#400): the forum card's `/w/<slug>/courts/<code>` link resolves to a detail
// shell (header with the parse banner, Halls/Adapter/Links tabs and a Rosters tab linking to the
// workspace rosters page with the forum selected, #435) read in the
// workspace's own scope by every role; the bare forum URL opens Halls; each tab page reads its read
// model; NOT_FOUND is a 404, FORBIDDEN permission-denied, anything else the load error. No page
// frames, embeds or fetches a court page.
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdapterStatus, CourtsIndex, ForumDetail, HallSeen } from '@causedeck/core/court';

import {
  adapterStatus,
  forum,
  forumDetail,
  forumRow,
  hallsSeen,
  sampleIndex,
} from '../components/courts/__tests__/fixtures.ts';
import { forumHref } from '../components/courts/forum-card.tsx';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const CODE = 'in.tn.madras-hc.principal.appellate';

const nav = vi.hoisted(() => ({ pathname: '' }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  error: null as Error | null,
}));
const data = vi.hoisted(() => ({
  detail: null as ForumDetail | null,
  index: null as CourtsIndex | null,
  status: null as AdapterStatus | null,
  halls: [] as HallSeen[],
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const court = vi.hoisted(() => {
  const answer = <T,>(value: () => T) =>
    vi.fn(() => (page.error === null ? Promise.resolve(value()) : Promise.reject(page.error)));
  return {
    getForumDetail: answer(() => data.detail),
    getCourtsIndex: answer(() => data.index),
    getAdapterStatus: answer(() => data.status),
    listHallsSeen: answer(() => data.halls),
  };
});
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/court', () => court);

// One at a time: concurrent imports race the mocks.
const { default: ForumLayout } = await import('../app/(app)/w/[slug]/courts/[code]/layout.tsx');
const { default: ForumPage } = await import('../app/(app)/w/[slug]/courts/[code]/page.tsx');
const { default: HallsPage } = await import('../app/(app)/w/[slug]/courts/[code]/halls/page.tsx');
const { default: AdapterPage } =
  await import('../app/(app)/w/[slug]/courts/[code]/adapter/page.tsx');
const { default: LinksPage } = await import('../app/(app)/w/[slug]/courts/[code]/links/page.tsx');

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

const params = (code = CODE) => ({ params: Promise.resolve({ slug: 'demo', code }) });

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(readonly code: string) {
    super(code);
  }
}

/** The sample index with the appellate forum's newest list failing for Hall 7. */
function failingIndex(): CourtsIndex {
  const index = sampleIndex();
  for (const city of index.cities) {
    for (const group of city.courts) {
      group.forums = group.forums.map((f) =>
        f.code === CODE
          ? forum({
              latestParse: {
                status: 'failed',
                at: new Date('2026-10-21T04:00:00Z'),
                hallsUnreadable: ['7'],
              },
            })
          : f,
      );
    }
  }
  return index;
}

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.error = null;
  data.detail = forumDetail();
  data.index = failingIndex();
  data.status = adapterStatus();
  data.halls = hallsSeen();
  nav.pathname = `/w/demo/courts/${CODE}/halls`;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noCourtFrames = () => {
  expect(document.querySelector('iframe, embed, object, frame')).toBeNull();
};

describe('forum detail layout (#400)', () => {
  it.each(['owner', 'advocate', 'clerk', 'viewer'] satisfies Role[])(
    'serves the forum card link with header, banner and tabs to a %s',
    async (role) => {
      page.context = testWorkspaceContext('demo', role);
      // The card on the index links here; the code segment comes back from that href.
      const segment = forumHref('demo', CODE).split('/').at(-1) ?? '';
      withIntl(await ForumLayout({ ...params(segment), children: <p>tab body</p> }));
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Madras High Court');
      expect(screen.getByRole('link', { name: 'All courts' }).getAttribute('href')).toBe(
        '/w/demo/courts',
      );
      expect(court.getForumDetail).toHaveBeenCalledWith({ tx: true }, 'ws-1', CODE);
      expect(runtime.inWorkspace).toHaveBeenCalledWith(
        { workspaceId: 'ws-1', userId: 'user-1' },
        expect.any(Function),
      );
      expect(document.querySelector('[data-forum-banner="failed"]')?.textContent).toContain(
        "Couldn't read today's list for Hall 7",
      );
      const tabs = within(screen.getByRole('navigation', { name: 'Forum sections' }));
      expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Halls',
        'Adapter',
        'Links',
        'Rosters',
      ]);
      expect(tabs.getByRole('link', { name: 'Halls' }).getAttribute('aria-current')).toBe('page');
      const rosters = tabs.getByRole('link', { name: 'Rosters' });
      expect(rosters.getAttribute('href')).toBe(`/w/demo/courts/rosters?forum=${CODE}`);
      expect(rosters.getAttribute('aria-current')).toBeNull();
      expect(screen.getByText('tab body')).toBeTruthy();
      noCourtFrames();
    },
  );

  it('shows no banner for a forum missing from the index (disabled)', async () => {
    data.index = { cities: [], disabled: [] };
    withIntl(await ForumLayout({ ...params(), children: null }));
    expect(document.querySelector('[data-forum-banner]')).toBeNull();
    expect(document.querySelector('[data-forum-status="none"]')).not.toBeNull();
  });

  it('is a 404 for an unknown forum code', async () => {
    page.error = new WorkspaceError('NOT_FOUND');
    await expect(ForumLayout({ ...params('nope'), children: null })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('renders permission-denied when core refuses access', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    withIntl(await ForumLayout({ ...params(), children: <p>tab body</p> }));
    expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    expect(screen.queryByText('tab body')).toBeNull();
  });

  it('shows the load error with Try again when loading fails', async () => {
    page.error = new Error('db down');
    withIntl(await ForumLayout({ ...params(), children: <p>tab body</p> }));
    expect(screen.getByText(catalogs.en.courts.error.title)).toBeTruthy();
    expect(screen.queryByText('tab body')).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });

  it('is not found without a workspace context', async () => {
    page.context = null;
    await expect(ForumLayout({ ...params(), children: null })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('forum detail tab pages (#400)', () => {
  it('the bare forum URL opens the Halls tab', async () => {
    await expect(ForumPage(params())).rejects.toThrow(`NEXT_REDIRECT /w/demo/courts/${CODE}/halls`);
  });

  it('Halls lists the halls seen in this workspace', async () => {
    withIntl(await HallsPage(params()));
    expect(court.listHallsSeen).toHaveBeenCalledWith({ tx: true }, 'ws-1', CODE);
    expect(screen.getByRole('table', { name: 'Halls seen in your lists' })).toBeTruthy();
    expect(document.querySelector('[data-hall="7"] [data-hall-unreadable]')).not.toBeNull();
  });

  it('Halls shows the educational empty state with no lists', async () => {
    data.halls = [];
    withIntl(await HallsPage(params()));
    expect(document.querySelector('[data-pattern-state="empty"]')?.textContent).toContain(
      'No halls seen yet',
    );
  });

  it('Adapter shows the status card and the access modes', async () => {
    withIntl(await AdapterPage(params()));
    expect(court.getAdapterStatus).toHaveBeenCalledWith(
      { tx: true },
      'ws-1',
      'in.tn.madras-hc.principal',
    );
    expect(document.querySelector('[data-adapter-status]')).not.toBeNull();
    expect(screen.getByText('Legal review pending')).toBeTruthy();
  });

  it('Adapter says so for a forum without an adapter', async () => {
    data.detail = forumDetail({ forum: forumRow({ adapterId: null }), accessModes: [] });
    withIntl(await AdapterPage(params()));
    expect(court.getAdapterStatus).not.toHaveBeenCalled();
    expect(document.querySelector('[data-adapter-none]')).not.toBeNull();
  });

  it('Links lists new-window anchors with the captcha notice and no frames', async () => {
    withIntl(await LinksPage(params()));
    const anchors = [...document.querySelectorAll('[data-deep-link] a')];
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(document.querySelectorAll('[data-captcha-notice]')).toHaveLength(1);
    noCourtFrames();
  });

  it.each([
    ['NOT_FOUND', 'not-found'],
    ['FORBIDDEN', 'denied'],
  ] as const)('a tab page maps %s', async (code, state) => {
    page.error = new WorkspaceError(code);
    if (state === 'not-found') {
      await expect(LinksPage(params())).rejects.toThrow('NEXT_NOT_FOUND');
    } else {
      withIntl(await HallsPage(params()));
      expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    }
  });

  it('a tab page shows the load error when loading fails', async () => {
    page.error = new Error('db down');
    withIntl(await AdapterPage(params()));
    expect(screen.getByText(catalogs.en.courts.error.title)).toBeTruthy();
  });
});
