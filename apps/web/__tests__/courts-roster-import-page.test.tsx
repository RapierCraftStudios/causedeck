// @vitest-environment jsdom
// Roster import page (#436, part 3 of #391): owners and advocates get the import review for the
// `?forum=` forum, resolved to its id from the courts index in their own workspace scope, with the
// part 1 actions and whether the forum already has an active roster (the supersede Dialog);
// juniors, clerks and viewers get permission-denied and nothing is read. Without a forum, or with
// one not in the index, the page asks for the forum. FORBIDDEN from core is permission-denied, any
// other failure the load error; `?__state=` previews in development only.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RostersPage } from '@causedeck/core/court';

import type * as RosterImportReviewModule from '../components/courts/roster-import-review.tsx';
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
  listForums: vi.fn(() =>
    page.error === null
      ? Promise.resolve([
          { id: 'f-mhc', code: MADRAS, court: 'Madras High Court', seat: 'Chennai' },
          { id: 'f-khc', code: KARNATAKA, court: 'High Court of Karnataka', seat: 'Bengaluru' },
        ])
      : Promise.reject(page.error),
  ),
  getRostersPage: vi.fn(() => Promise.resolve(page.rosters as RostersPage)),
}));
const actions = vi.hoisted(() => ({
  previewRosterImportAction: vi.fn(),
  confirmRosterImportAction: vi.fn(),
}));
const review = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/w/demo/courts/rosters/import',
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
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/court', () => court);
vi.mock('../app/(app)/w/[slug]/courts/rosters/actions.ts', () => actions);
// The review itself is covered by components/courts/__tests__/roster-import-review.test.tsx; here
// only what the page hands it.
vi.mock('../components/courts/roster-import-review.tsx', async (importOriginal) => {
  const original = await importOriginal<typeof RosterImportReviewModule>();
  return {
    ...original,
    RosterImportReview: (props: Record<string, unknown>) => {
      review.props = props;
      return <div data-review-stub="" />;
    },
  };
});

const { default: RosterImportPage, generateMetadata } =
  await import('../app/(app)/w/[slug]/courts/rosters/import/page.tsx');

const en = catalogs.en.courtsRosters.import;

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

class WorkspaceError extends Error {
  override name = 'WorkspaceError';
  constructor(readonly code: string) {
    super(code);
  }
}

function rostersPage(madrasStatus: 'active' | 'superseded'): RostersPage {
  return {
    forums: [
      {
        forum: { id: 'f-mhc', code: MADRAS, court: 'Madras High Court', seat: 'Chennai' },
        rosters: [{ id: 'r-1', status: madrasStatus, effectiveFrom: '2026-10-05' }],
        activeRosterId: null,
        halls: [],
      },
    ],
    alerts: [],
  } as unknown as RostersPage;
}

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.rosters = rostersPage('active');
  page.error = null;
  review.props = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const denied = () => document.querySelector('[data-pattern-state="permission-denied"]');

describe('roster import page (#436)', () => {
  it.each(['owner', 'advocate'] satisfies Role[])(
    'gives a %s the review for the ?forum= forum, with its id and the actions',
    async (role) => {
      page.context = testWorkspaceContext('demo', role);
      withIntl(await RosterImportPage(props({ forum: MADRAS })));
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
      expect(runtime.inWorkspace).toHaveBeenCalledWith(
        { workspaceId: 'ws-1', userId: 'user-1' },
        expect.any(Function),
      );
      expect(court.listForums).toHaveBeenCalledWith({ tx: true }, 'ws-1');
      expect(review.props).toMatchObject({
        slug: 'demo',
        workspaceId: 'ws-1',
        forum: { id: 'f-mhc', code: MADRAS, court: 'Madras High Court' },
        hasActiveRoster: true,
        preview: actions.previewRosterImportAction,
        confirm: actions.confirmRosterImportAction,
      });
      expect(denied()).toBeNull();
      expect(screen.getByRole('link', { name: en.back }).getAttribute('href')).toBe(
        `/w/demo/courts/rosters?forum=${encodeURIComponent(MADRAS)}`,
      );
    },
  );

  it('knows a forum without an active roster needs no supersede', async () => {
    page.rosters = rostersPage('superseded');
    withIntl(await RosterImportPage(props({ forum: MADRAS })));
    expect(review.props?.hasActiveRoster).toBe(false);
  });

  it('knows a forum with no rosters at all needs no supersede', async () => {
    withIntl(await RosterImportPage(props({ forum: KARNATAKA })));
    expect(review.props).toMatchObject({ forum: { id: 'f-khc' }, hasActiveRoster: false });
  });

  it.each(['junior', 'clerk', 'viewer'] satisfies Role[])(
    'gives a %s permission-denied without reading anything',
    async (role) => {
      page.context = testWorkspaceContext('demo', role);
      withIntl(await RosterImportPage(props({ forum: MADRAS })));
      expect(denied()).not.toBeNull();
      expect(review.props).toBeNull();
      expect(court.listForums).not.toHaveBeenCalled();
    },
  );

  it.each([{}, { forum: 'in.nowhere' }])(
    'asks for the forum without a known one (%o)',
    async (query) => {
      withIntl(await RosterImportPage(props(query)));
      expect(review.props).toBeNull();
      expect(screen.getByText(en.chooseForum.title)).toBeTruthy();
      expect(screen.getByRole('combobox', { name: en.chooseForum.label })).toBeTruthy();
    },
  );

  it('renders permission-denied when core refuses access', async () => {
    page.error = new WorkspaceError('FORBIDDEN');
    withIntl(await RosterImportPage(props({ forum: MADRAS })));
    expect(denied()).not.toBeNull();
  });

  it('renders the load error on any other failure', async () => {
    page.error = new Error('db down');
    withIntl(await RosterImportPage(props({ forum: MADRAS })));
    expect(screen.getByText(catalogs.en.courtsRosters.error.title)).toBeTruthy();
    expect(logger.error).toHaveBeenCalled();
    expect(review.props).toBeNull();
  });

  it('404s outside a workspace the member belongs to', async () => {
    page.context = null;
    await expect(RosterImportPage(props())).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('previews loading, error and permission-denied in development only', async () => {
    withIntl(await RosterImportPage(props({ __state: 'denied' })));
    expect(denied()).not.toBeNull();
    cleanup();
    await expect(RosterImportPage(props({ __state: 'error' }))).rejects.toThrow('dev toggle');
    withIntl(await RosterImportPage(props({ __state: 'loading' })));
    expect(
      document.querySelector('[data-pattern-state="loading"], [aria-busy="true"]'),
    ).not.toBeNull();
    cleanup();
    page.dev = false;
    withIntl(await RosterImportPage(props({ __state: 'denied', forum: MADRAS })));
    expect(denied()).toBeNull();
    expect(review.props).not.toBeNull();
  });

  it('titles the page', async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: en.metaTitle });
  });
});
