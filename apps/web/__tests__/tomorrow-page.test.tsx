// @vitest-environment jsdom
// Tomorrow plan page (#63): the next court day's appearances with an assignee picker, unassigned
// and clashing items first, suggestions as proposals, and the live outcome strip for the owner
// only. Denied without `court_day.view_all`; a load failure shows `Try again`; empty and offline
// states; every string comes from the en, ta and kn catalogs.
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  locale: 'en' as TestLocale,
  items: [] as Record<string, unknown>[],
  suggestions: [] as Record<string, unknown>[],
  outcomes: null as Record<string, unknown> | null,
  error: null as Error | null,
}));
const runtime = vi.hoisted(() => ({
  listMembersIn: vi.fn(() =>
    Promise.resolve([
      { memberId: 'm1', name: 'Asha Rao' },
      { memberId: 'm2', name: 'Vikram Shah' },
    ]),
  ),
  inWorkspace: vi.fn((_scope: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tx: true })),
}));
const courtDay = vi.hoisted(() => ({
  getCourtDay: vi.fn(() =>
    page.error === null
      ? Promise.resolve({
          complexes: [{ halls: [{ lists: [{ items: page.items }] }] }],
        })
      : Promise.reject(page.error),
  ),
}));
const delegation = vi.hoisted(() => ({
  suggestAssignments: vi.fn(() => Promise.resolve({ suggestions: page.suggestions })),
  chamberOutcomesLive: vi.fn(() => Promise.resolve(page.outcomes)),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations(page.locale)(namespace),
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/core/runtime', () => runtime);
vi.mock('@causedeck/core/court-day', () => courtDay);
vi.mock('@causedeck/core/delegation', () => delegation);
vi.mock('../app/(app)/w/[slug]/tomorrow/plan/actions.ts', () => ({
  assignAppearanceAction: vi.fn(),
  acceptSuggestionAction: vi.fn(),
  acceptAllSuggestionsAction: vi.fn(),
  outcomesLiveAction: vi.fn(),
}));

const { default: TomorrowPage } = await import('../app/(app)/w/[slug]/tomorrow/page.tsx');

const item = (listingId: string, itemNo: number, assigneeMemberId: string | null) => ({
  listingId,
  itemNo,
  matterTitle: `Matter ${String(itemNo)}`,
  caseLabel: `WP ${String(itemNo)}/2026`,
  hallNo: '4',
  assigneeMemberId,
  capacity: 'arguing',
});

const OUTCOMES = {
  members: [{ memberId: 'm1', name: 'Asha Rao', total: 5, outcomesIn: 2 }],
  lastConfirmedAt: new Date('2026-10-25T09:00:00Z'),
};

const withIntl = (ui: ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
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

beforeEach(() => {
  page.context = testWorkspaceContext('demo', 'owner');
  page.dev = true;
  page.locale = 'en';
  page.items = [item('l1', 1, 'm1'), item('l2', 2, null), item('l3', 3, 'm2')];
  page.suggestions = [
    { listingId: 'l2', memberId: 'm2', kind: 'unassigned', reason: 'Vikram is free.' },
  ];
  page.outcomes = OUTCOMES;
  page.error = null;
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('tomorrow page (#63)', () => {
  it('renders the plan with unassigned items first, read in its own workspace scope', async () => {
    withIntl(await TomorrowPage(props()));
    const en = catalogs.en.delegation;
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    const rows = document.querySelectorAll('[data-slot="assignment-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute('data-flag')).toBe('unassigned');
    expect(rows[0]?.textContent).toContain('Matter 2');
    expect(runtime.listMembersIn).toHaveBeenCalledWith({ workspaceId: 'ws-1', userId: 'user-1' });
  });

  it('shows the live outcome strip to the owner only', async () => {
    withIntl(await TomorrowPage(props()));
    expect(screen.getByRole('status').textContent).toContain('2 of 5');
    expect(delegation.chamberOutcomesLive).toHaveBeenCalled();

    cleanup();
    delegation.chamberOutcomesLive.mockClear();
    page.context = testWorkspaceContext('demo', 'advocate');
    withIntl(await TomorrowPage(props()));
    expect(screen.queryByRole('status')).toBeNull();
    expect(delegation.chamberOutcomesLive).not.toHaveBeenCalled();
  });

  it.each(['junior', 'clerk', 'viewer'] satisfies Role[])(
    'renders permission-denied for a %s',
    async (role) => {
      page.context = testWorkspaceContext('demo', role);
      withIntl(await TomorrowPage(props()));
      expect(document.querySelector('[data-pattern-state="permission-denied"]')).not.toBeNull();
      expect(document.querySelector('[data-slot="assignment-row"]')).toBeNull();
      expect(runtime.listMembersIn).not.toHaveBeenCalled();
    },
  );

  it('shows the empty state when nothing is listed', async () => {
    page.items = [];
    withIntl(await TomorrowPage(props()));
    expect(document.querySelector('[data-pattern-state="empty"]')?.textContent).toContain(
      catalogs.en.delegation.empty,
    );
  });

  it('shows the error state with Try again and logs when loading fails', async () => {
    page.error = new Error('db down');
    withIntl(await TomorrowPage(props()));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(catalogs.en.delegation.error);
    expect(within(alert).getByText(catalogs.en.delegation.retry)).toBeTruthy();
    expect(logger.error).toHaveBeenCalled();
  });

  it('previews loading and error states in dev only', async () => {
    withIntl(await TomorrowPage(props({ __state: 'error' })));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(logger.error).not.toHaveBeenCalled();
    cleanup();
    page.dev = false;
    withIntl(await TomorrowPage(props({ __state: 'error' })));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the offline banner while offline', async () => {
    setOnline(false);
    withIntl(await TomorrowPage(props()));
    expect(document.body.textContent).toContain(
      catalogs.en.shell.offline.message.split(' {')[0] ?? '',
    );
  });

  it.each(['ta', 'kn'] satisfies TestLocale[])('renders only %s strings', async (locale) => {
    page.locale = locale;
    withIntl(await TomorrowPage(props()), locale);
    const text = document.body.textContent;
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      catalogs[locale].delegation.title,
    );
    expect(catalogs[locale].delegation.title).not.toBe(catalogs.en.delegation.title);
    expect(text).toContain(catalogs[locale].delegation.unassigned);
    expect(text).not.toContain(catalogs.en.delegation.unassigned);
    expect(text).not.toContain(catalogs.en.delegation.description);
  });

  it.each(['ta', 'kn'] satisfies TestLocale[])(
    'renders the %s empty and error states',
    async (locale) => {
      page.locale = locale;
      page.items = [];
      withIntl(await TomorrowPage(props()), locale);
      expect(document.body.textContent).toContain(catalogs[locale].delegation.empty);
      cleanup();
      page.error = new Error('db down');
      withIntl(await TomorrowPage(props()), locale);
      expect(document.body.textContent).toContain(catalogs[locale].delegation.error);
      expect(document.body.textContent).not.toContain(catalogs.en.delegation.error);
    },
  );
});
