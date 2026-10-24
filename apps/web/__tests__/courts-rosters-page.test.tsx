// @vitest-environment jsdom
// Courts rosters page (#435, part 2 of #391): every role reads the workspace's rosters from
// `getRostersPage` in its own workspace scope, for today in India; the selected forum (`?forum=`,
// else the first) shows its versions with effective dates and status, the roster in force badged
// "Active today", its halls, and a banner of open bench-change alerts linking to each matter.
// Owners and advocates get `Import roster` (disabled offline); clerks and viewers a read-only list.
// FORBIDDEN is permission-denied, any other failure the load error, no rosters the empty state;
// `?__state=loading|error|denied` previews in development only. The route's loading.tsx and
// error.tsx boundaries are covered too.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RostersPage, RostersPageForum } from '@causedeck/core/court';

import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const MADRAS = 'in.tn.madras-hc.principal.appellate';
const KARNATAKA = 'in.ka.karnataka-hc.bengaluru';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  rosters: null as RostersPage | null,
  error: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const court = vi.hoisted(() => ({
  getRostersPage: vi.fn<(tx: unknown, actor: unknown, input: unknown) => Promise<RostersPage>>(
    () =>
      page.error === null
        ? Promise.resolve(page.rosters as RostersPage)
        : Promise.reject(page.error),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));
const reportError = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/w/demo/courts/rosters',
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../lib/report-error.ts', () => ({ reportError }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/court', () => court);

// One at a time: concurrent imports race the mocks.
const { default: RostersPageRoute } = await import('../app/(app)/w/[slug]/courts/rosters/page.tsx');
const { default: RostersLoading } =
  await import('../app/(app)/w/[slug]/courts/rosters/loading.tsx');
const { default: RostersError } = await import('../app/(app)/w/[slug]/courts/rosters/error.tsx');

const en = catalogs.en.courtsRosters;

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

const bench = (id: string, judges: string[]) => ({
  id,
  label: judges.length === 0 ? null : judges.join(', '),
  benchKind: 'single' as const,
  judges,
});

function roster(
  id: string,
  forumId: string,
  overrides: Partial<RostersPageForum['rosters'][number]> = {},
): RostersPageForum['rosters'][number] {
  return {
    id,
    workspaceId: 'ws-1',
    forumId,
    effectiveFrom: '2026-10-05',
    effectiveTo: null,
    status: 'active',
    version: 1,
    sourceDocumentId: null,
    confirmationState: 'confirmed',
    note: null,
    createdAt: new Date('2026-10-04T10:00:00Z'),
    updatedAt: new Date('2026-10-04T10:00:00Z'),
    entryCount: 2,
    ...overrides,
  } as RostersPageForum['rosters'][number];
}

function rostersPage(): RostersPage {
  return {
    forums: [
      {
        forum: { id: 'f-mhc', code: MADRAS, court: 'Madras High Court', seat: 'Chennai' },
        rosters: [
          roster('r-oct', 'f-mhc', { version: 2, entryCount: 2 }),
          roster('r-sep', 'f-mhc', {
            version: 1,
            status: 'superseded',
            effectiveFrom: '2026-09-01',
            effectiveTo: '2026-10-05',
            entryCount: 1,
          }),
        ],
        activeRosterId: 'r-oct',
        halls: [
          {
            entryId: 'e-1',
            hallNo: '1',
            portfolioText: 'Writ petitions (fictional)',
            bench: bench('b-1', ['Justice A (fictional)']),
          },
          {
            entryId: 'e-7',
            hallNo: '7',
            portfolioText: 'Second appeals (fictional)',
            bench: bench('b-7', ['Justice X (fictional)']),
          },
        ],
      },
      {
        forum: {
          id: 'f-khc',
          code: KARNATAKA,
          court: 'High Court of Karnataka',
          seat: 'Bengaluru',
        },
        rosters: [roster('r-khc', 'f-khc', { effectiveFrom: '2026-10-12' })],
        activeRosterId: null,
        halls: [],
      },
    ],
    alerts: [
      {
        alertId: 'a-1',
        proceedingId: 'p-1',
        matterId: 'm-1',
        matterTitle: 'Raman v. State (fictional)',
        forumId: 'f-mhc',
        rosterId: 'r-oct',
        effectiveFrom: '2026-10-05',
        reason: 'hall',
        createdAt: new Date('2026-10-05T03:00:00Z'),
        oldBench: bench('b-1', ['Justice A (fictional)']),
        newBench: bench('b-7', ['Justice X (fictional)']),
      },
    ],
  };
}

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.rosters = rostersPage();
  page.error = null;
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('courts rosters page (#435)', () => {
  it.each(['owner', 'advocate', 'junior', 'clerk', 'viewer'] satisfies Role[])(
    'lists the rosters of the first forum to a %s, read in its own workspace',
    async (role) => {
      page.context = testWorkspaceContext('demo', role);
      withIntl(await RostersPageRoute(props()));
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
      expect(runtime.inWorkspace).toHaveBeenCalledWith(
        { workspaceId: 'ws-1', userId: 'user-1' },
        expect.any(Function),
      );
      expect(court.getRostersPage).toHaveBeenCalledWith(
        { tx: true },
        { workspaceId: 'ws-1', userId: 'user-1' },
        { on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string },
      );
      const versions = within(screen.getByRole('list', { name: en.roster.listLabel }));
      const [october, september] = versions.getAllByRole('listitem');
      expect(october?.textContent).toContain('From 5 Oct 2026');
      expect(october?.textContent).toContain(en.roster.activeToday);
      expect(october?.textContent).toContain(en.roster.status.active);
      expect(october?.textContent).toContain('2 halls');
      expect(september?.textContent).toContain('From 1 Sept 2026');
      expect(september?.textContent).toContain(en.roster.status.superseded);
      const halls = screen.getByRole('table');
      expect(halls.textContent).toContain('Justice X (fictional)');
      expect(halls.textContent).toContain('Second appeals (fictional)');
      expect(document.querySelector('[data-pattern-state="permission-denied"]')).toBeNull();
    },
  );

  it('asks for today in India, not UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T19:00:00Z')); // 00:30 on 22 Oct in Chennai
    withIntl(await RostersPageRoute(props()));
    expect(court.getRostersPage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      on: '2026-10-22',
    });
  });

  it('shows open bench changes on the selected forum with a link to each matter', async () => {
    withIntl(await RostersPageRoute(props()));
    const banner = screen.getByRole('region', { name: en.alerts.title });
    expect(banner.textContent).toContain(
      'Bench changed from 05 Oct: Raman v. State (fictional) now sits with Justice X (fictional).',
    );
    expect(
      within(banner).getByRole('link', { name: 'Raman v. State (fictional)' }).getAttribute('href'),
    ).toBe('/w/demo/matters/m-1');
  });

  it('selects the forum from ?forum= and falls back to the first for an unknown code', async () => {
    withIntl(await RostersPageRoute(props({ forum: KARNATAKA })));
    expect(
      document.querySelector('[data-roster-forum-panel]')?.getAttribute('data-roster-forum-panel'),
    ).toBe(KARNATAKA);
    expect(screen.getByText(en.halls.noneInForce.title)).toBeTruthy();
    expect(screen.getByText(en.alerts.none)).toBeTruthy();
    const rail = screen.getByRole('navigation', { name: en.forums.rail });
    expect(
      within(rail).getByRole('link', { current: 'page' }).getAttribute('data-roster-forum'),
    ).toBe(KARNATAKA);
    cleanup();
    withIntl(await RostersPageRoute(props({ forum: 'in.xx.unknown' })));
    expect(
      document.querySelector('[data-roster-forum-panel]')?.getAttribute('data-roster-forum-panel'),
    ).toBe(MADRAS);
  });

  it.each([
    ['owner', true],
    ['advocate', true],
    ['junior', false],
    ['clerk', false],
    ['viewer', false],
  ] satisfies [Role, boolean][])('Import roster for a %s: %s', async (role, shown) => {
    page.context = testWorkspaceContext('demo', role);
    withIntl(await RostersPageRoute(props()));
    const link = screen.queryByRole('link', { name: en.importRoster });
    expect(link !== null).toBe(shown);
    if (link !== null) {
      expect(link.getAttribute('href')).toBe(`/w/demo/courts/rosters/import?forum=${MADRAS}`);
    }
    expect(screen.queryByText(en.readOnly) !== null).toBe(!shown);
  });

  it('renders permission-denied when core refuses access', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    withIntl(await RostersPageRoute(props()));
    expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('shows the load error with Try again when loading fails', async () => {
    page.error = new Error('db down');
    withIntl(await RostersPageRoute(props()));
    expect(screen.getByText(en.error.title)).toBeTruthy();
    expect(screen.queryByRole('link', { name: en.importRoster })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('shows the empty state when no roster has been imported', async () => {
    page.rosters = { forums: [], alerts: [] };
    withIntl(await RostersPageRoute(props()));
    const empty = document.querySelector('[data-pattern-state="empty"]');
    expect(empty?.textContent).toContain(en.empty.title);
    expect(empty?.textContent).toContain(en.empty.hint);
    expect(screen.getByRole('link', { name: en.importRoster }).getAttribute('href')).toBe(
      '/w/demo/courts/rosters/import',
    );
  });

  it('keeps the list readable offline with import disabled', async () => {
    setOnline(false);
    withIntl(await RostersPageRoute(props()));
    expect(document.querySelector('[data-courts-offline]')?.textContent).toMatch(
      /^Showing saved court information from .+\.$/,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByRole('link', { name: en.importRoster })).toBeNull();
    expect(screen.getByRole('button', { name: en.importRoster })).toHaveProperty('disabled', true);
    expect(screen.getByText(en.importOffline)).toBeTruthy();
  });

  it('previews loading, error and permission-denied in development only', async () => {
    withIntl(await RostersPageRoute(props({ __state: 'loading' })));
    expect(document.querySelector('[data-slot="rosters-skeleton"]')).not.toBeNull();
    cleanup();
    await expect(RostersPageRoute(props({ __state: 'error' }))).rejects.toThrow();
    withIntl(await RostersPageRoute(props({ __state: 'denied' })));
    expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
    expect(court.getRostersPage).not.toHaveBeenCalled();
    cleanup();
    page.dev = false;
    withIntl(await RostersPageRoute(props({ __state: 'loading' })));
    expect(document.querySelector('[data-slot="rosters-skeleton"]')).toBeNull();
    expect(screen.getByRole('table')).toBeTruthy();
    cleanup();
    withIntl(await RostersPageRoute(props({ __state: 'denied' })));
    expect(document.querySelector('[data-pattern-state="permission-denied"]')).toBeNull();
  });

  it('is not found without a workspace context', async () => {
    page.context = null;
    await expect(RostersPageRoute(props())).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('courts rosters route boundaries (#435)', () => {
  it('loading.tsx is a labelled skeleton of roster rows', () => {
    withIntl(<RostersLoading />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(en.loading);
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(document.querySelectorAll('[data-rosters-skeleton-row]').length).toBeGreaterThan(0);
  });

  it('error.tsx reports the error and retries with reset', () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('boom'), { digest: 'd1' });
    withIntl(<RostersError error={error} reset={reset} />);
    expect(screen.getByText(en.error.title)).toBeTruthy();
    expect(screen.queryByText('boom')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(reset).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(error, { boundary: 'route', digest: 'd1' });
  });
});
