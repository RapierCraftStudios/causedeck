// @vitest-environment jsdom
// `/w/[slug]/activity` security and audit tab (#232): the server page (URL filters into
// `queryAudit`, permission-denied and error states), the client view (sentences, outcome badges and
// the denied tint, the owner-only IP column, cards below 768 px, empty and offline states, J/K/Enter
// and E, the lazy drawer with its chain status and copy id, the export dialog's POST) and the
// `settings/audit` redirect. Every string comes from the catalogs.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { mockMatchMedia, stubResizeObserver } from '../components/shell/__tests__/helpers.tsx';

import type {
  AuditFeedActions,
  AuditFeedEvent,
  AuditFeedPage,
} from '../app/(app)/w/[slug]/activity/audit-feed.tsx';
import type { AuditFilterValues } from '../app/(app)/w/[slug]/activity/filter-params.ts';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
const queryAudit = vi.hoisted(() => vi.fn());
const listMembers = vi.hoisted(() => vi.fn());
const page = vi.hoisted(() => ({ context: null as WorkspaceContext | null, dev: true }));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/w/chennai-solo/activity',
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
vi.mock('@causedeck/ui/sonner', () => ({ toast }));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../lib/env.ts', () => ({ isDev: () => page.dev }));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../components/shell/offline-banner.tsx', () => ({ ShellOfflineBanner: () => null }));
vi.mock('@causedeck/db', () => ({
  db: { fake: 'db' },
  withWorkspace: (_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
}));
vi.mock('@causedeck/core/audit', () => ({ queryAudit }));
vi.mock('@causedeck/core/workspaces', () => ({ listMembers }));
vi.mock('../app/(app)/w/[slug]/activity/actions.ts', () => ({
  loadMoreAuditAction: vi.fn(),
  verifyAuditEventAction: vi.fn(),
  loadMoreActivitiesAction: vi.fn(),
  previewActivityUndoAction: vi.fn(),
  undoActivityAction: vi.fn(),
  undoCaptureAction: vi.fn(),
  reassignCaptureAction: vi.fn(),
}));

const { AuditFeed } = await import('../app/(app)/w/[slug]/activity/audit-feed.tsx');
const { default: ActivityPage } = await import('../app/(app)/w/[slug]/activity/page.tsx');
const { default: AuditSettingsPage } =
  await import('../app/(app)/w/[slug]/settings/audit/page.tsx');
const { parseAuditFilters, istDayStart, istDayAfter, auditFilterQuery } =
  await import('../app/(app)/w/[slug]/activity/filter-params.ts');

const en = catalogs.en.audit;

const WORKSPACE = {
  id: '00000000-0000-4000-8000-00000000a001',
  slug: 'chennai-solo',
  name: 'Iyer Chambers',
};
const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';
const JUNIOR_ID = '00000000-0000-4000-8000-0000000000b2';
const MEMBERS = [
  { memberId: 'm-owner', userId: OWNER_ID, name: 'Asha Rao' },
  { memberId: 'm-junior', userId: JUNIOR_ID, name: 'Meera Nair' },
];

function auditEvent(overrides: Partial<AuditFeedEvent> = {}): AuditFeedEvent {
  return {
    id: '00000000-0000-4000-8000-00000000e001',
    createdAt: '2026-10-18T04:30:00.000000Z',
    actorUserId: OWNER_ID,
    actorKind: 'user',
    action: 'member.role_changed',
    targetKind: 'user',
    targetId: JUNIOR_ID,
    outcome: 'success',
    requestId: 'req-1',
    userAgentHash: null,
    metadata: { role: 'clerk' },
    hash: 'ab'.repeat(32),
    ip: '203.0.113.0/24',
    ...overrides,
  };
}

const ROLE_CHANGED = auditEvent();
const DENIED = auditEvent({
  id: '00000000-0000-4000-8000-00000000e002',
  createdAt: '2026-10-18T04:00:00.000000Z',
  action: 'audit.exported',
  actorUserId: JUNIOR_ID,
  targetKind: null,
  targetId: null,
  outcome: 'denied',
  metadata: {},
});
const SYSTEM = auditEvent({
  id: '00000000-0000-4000-8000-00000000e003',
  createdAt: '2026-10-17T22:00:00.000000Z',
  action: 'auth.sign_in_failed',
  actorKind: 'system',
  actorUserId: null,
  targetKind: null,
  targetId: null,
  outcome: 'error',
  metadata: {},
});

function fakeActions() {
  return {
    loadMore: vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { events: [SYSTEM], nextCursor: null } }),
    ),
    verifyEvent: vi.fn(() => Promise.resolve({ ok: true as const, data: 'verified' as const })),
  } satisfies AuditFeedActions;
}

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

function view(
  props: Partial<{
    page: AuditFeedPage;
    isOwner: boolean;
    filters: AuditFilterValues;
    actions: AuditFeedActions;
  }> = {},
) {
  const actions = props.actions ?? fakeActions();
  withIntl(
    <AuditFeed
      workspace={{ id: WORKSPACE.id, slug: WORKSPACE.slug }}
      initialPage={props.page ?? { events: [ROLE_CHANGED, DENIED], nextCursor: null }}
      members={MEMBERS}
      isOwner={props.isOwner ?? true}
      filters={props.filters ?? {}}
      actions={actions}
    />,
  );
  return actions;
}

let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  mockMatchMedia();
  stubResizeObserver();
  page.context = {
    user: { id: OWNER_ID, name: 'Asha Rao', email: 'owner@x.test' },
    workspace: WORKSPACE,
    role: 'owner',
    memberships: [],
  };
  page.dev = true;
  queryAudit.mockResolvedValue({ events: [ROLE_CHANGED, DENIED], nextCursor: null });
  listMembers.mockResolvedValue(MEMBERS.map((m) => ({ ...m, email: '', role: 'owner' })));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/** The `index`th element, failing the test when it is missing. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}

/** Render the page, resolving the async feed section inside its Suspense boundary. */
async function renderPage(search: Record<string, string> = {}) {
  const tree = (await ActivityPage({
    params: Promise.resolve({ slug: WORKSPACE.slug }),
    // The security and audit view is `?tab=security` beside the automation feed (#49).
    searchParams: Promise.resolve({ tab: 'security', ...search }),
  })) as ReactElement<{ children: ReactElement[] }>;
  // Children: the offline banner (mocked out), the header, the tab nav, then the feed.
  const [, header, nav, body] = tree.props.children as [
    ReactElement,
    ReactElement,
    ReactElement,
    ReactElement<{ children?: unknown }>,
  ];
  const section = (body.props as { children?: ReactElement }).children;
  let content: ReactNode = body;
  if (section && typeof section.type === 'function') {
    const Section = section.type as (props: unknown) => Promise<ReactNode>;
    content = await Section(section.props);
  }
  withIntl(
    <div>
      {header}
      {nav}
      {content}
    </div>,
  );
}

describe('activity page (server)', () => {
  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the security tab and reads the feed with the URL filters as IST bounds', async () => {
    await renderPage({ from: '2026-10-01', to: '2026-10-18', action: 'member', actor: 'nope' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    const tab = screen.getByRole('link', { name: en.tabs.security });
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(queryAudit).toHaveBeenCalledWith(
      { db: { fake: 'db' }, workspaceId: WORKSPACE.id, userId: OWNER_ID },
      {
        from: new Date('2026-09-30T18:30:00.000Z'),
        to: new Date('2026-10-18T18:30:00.000Z'),
        actionGroup: 'member',
      },
    );
    expect(screen.getByText("Asha Rao changed Meera Nair's role to Clerk")).toBeTruthy();
  });

  it('shows the permission-denied state when audit.read is refused', async () => {
    const error = Object.assign(new Error('You cannot read the audit log'), {
      name: 'WorkspaceError',
      code: 'FORBIDDEN',
    });
    queryAudit.mockRejectedValue(error);
    await renderPage();
    expect(screen.getByText(en.denied)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the error state with Try again when loading fails', async () => {
    queryAudit.mockRejectedValue(new Error('db down'));
    await renderPage();
    expect(screen.getByText(en.error.title)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('previews the loading state in development', async () => {
    await renderPage({ __state: 'loading' });
    expect(document.querySelector('[data-slot="audit-skeleton"]')).not.toBeNull();
    expect(queryAudit).not.toHaveBeenCalled();
  });
});

describe('settings/audit', () => {
  it('redirects to the activity page', async () => {
    await expect(
      AuditSettingsPage({ params: Promise.resolve({ slug: WORKSPACE.slug }) }),
    ).rejects.toThrow('NEXT_REDIRECT /w/chennai-solo/activity?tab=security');
  });
});

describe('audit feed (client)', () => {
  it('shows sentence, who, when and outcome with the denied tint, and IP for owners', () => {
    view();
    const table = screen.getByRole('table', { name: en.tableLabel });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toEqual([
      en.columns.when,
      en.columns.who,
      en.columns.what,
      en.columns.target,
      en.columns.outcome,
      en.columns.ip,
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(nth(rows, 0)).getByText('203.0.113.0/24')).toBeTruthy();
    expect(within(nth(rows, 0)).getByText(en.outcome.success)).toBeTruthy();
    expect(nth(rows, 0).className).not.toContain('bg-warning-soft');
    expect(within(nth(rows, 1)).getByText('Meera Nair exported the audit log')).toBeTruthy();
    expect(within(nth(rows, 1)).getByText(en.outcome.denied)).toBeTruthy();
    expect(nth(rows, 1).className).toContain('bg-warning-soft');
  });

  it('hides the IP column from non-owners', () => {
    view({ isOwner: false });
    expect(screen.queryByRole('columnheader', { name: en.columns.ip })).toBeNull();
    expect(screen.queryByText('203.0.113.0/24')).toBeNull();
  });

  it('names system actors and falls back to the action name for unknown actions', () => {
    view({ page: { events: [SYSTEM], nextCursor: null } });
    expect(screen.getByText('CauseDeck recorded auth.sign_in_failed')).toBeTruthy();
    expect(screen.getByText(en.outcome.error)).toBeTruthy();
  });

  it('shows cards below 768 px', () => {
    mockMatchMedia({ '(max-width: 767px)': true });
    view();
    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: en.tableLabel });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
  });

  it('shows the empty state', () => {
    view({ page: { events: [], nextCursor: null } });
    expect(screen.getByText(en.empty)).toBeTruthy();
  });

  it('pauses filters, export and load more while offline', () => {
    online = false;
    view({ page: { events: [ROLE_CHANGED], nextCursor: 'c1' } });
    expect(screen.getByText(en.offline)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.export.button }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: en.loadMore }).hasAttribute('disabled')).toBe(true);
    for (const chip of document.querySelectorAll('[data-slot="audit-filter-chip"]')) {
      expect(chip.hasAttribute('disabled')).toBe(true);
    }
  });

  it('moves focus with J and K, announces the row, and opens the drawer with Enter', async () => {
    const actions = view();
    const rows = screen.getAllByRole('row').slice(1);
    expect(nth(rows, 0).getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(document.body, { key: 'j' });
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[1]);
    });
    expect(nth(rows, 1).getAttribute('tabindex')).toBe('0');
    expect(screen.getByText('Selected: Meera Nair exported the audit log')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'k' });
    await waitFor(() => {
      expect(document.activeElement).toBe(rows[0]);
    });
    fireEvent.keyDown(nth(rows, 0), { key: 'Enter' });
    const drawer = await screen.findByRole('dialog', { name: en.drawer.title });
    expect(within(drawer).getByText('"role": "clerk"', { exact: false })).toBeTruthy();
    await waitFor(() => {
      expect(within(drawer).getByText(en.drawer.chainVerified)).toBeTruthy();
    });
    expect(actions.verifyEvent).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      eventId: ROLE_CHANGED.id,
      createdAt: ROLE_CHANGED.createdAt,
    });
  });

  it('shows Chain not yet verified when the check fails, and copies the event id', async () => {
    const actions = fakeActions();
    actions.verifyEvent.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', message: '' },
    } as never);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    view({ actions });
    fireEvent.click(nth(screen.getAllByRole('row'), 1));
    const drawer = await screen.findByRole('dialog', { name: en.drawer.title });
    await waitFor(() => {
      expect(within(drawer).getByText(en.drawer.chainUnverified)).toBeTruthy();
    });
    fireEvent.click(within(drawer).getByRole('button', { name: en.drawer.copyId }));
    expect(writeText).toHaveBeenCalledWith(ROLE_CHANGED.id);
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.drawer.copied);
    });
  });

  it('loads more events by cursor with the current filters', async () => {
    const actions = view({
      page: { events: [ROLE_CHANGED], nextCursor: 'c1' },
      filters: { from: '2026-10-01', action: 'member' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.loadMore }));
    await screen.findByText('CauseDeck recorded auth.sign_in_failed');
    expect(actions.loadMore).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      cursor: 'c1',
      from: '2026-09-30T18:30:00.000Z',
      actionGroup: 'member',
    });
    expect(screen.queryByRole('button', { name: en.loadMore })).toBeNull();
  });

  it('filter chips are buttons with aria-expanded; Clear filters resets the URL', async () => {
    view({ filters: { action: 'member' } });
    const chips = [...document.querySelectorAll('[data-slot="audit-filter-chip"]')];
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('aria-expanded')).toBe('false');
    }
    expect(nth(chips, 2).textContent).toContain(en.filters.groups.member);
    fireEvent.click(nth(chips, 0));
    expect(nth(chips, 0).getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('dialog', { name: en.filters.date })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => {
      expect(nth(chips, 0).getAttribute('aria-expanded')).toBe('false');
    });
    fireEvent.click(screen.getByRole('button', { name: en.filters.clear }));
    expect(router.replace).toHaveBeenCalledWith('/w/chennai-solo/activity?tab=security', {
      scroll: false,
    });
  });

  it('E opens the export dialog, which posts the range and follows the signed link', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ url: '/api/audit/export?token=t', expiresAt: 'x' }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.fn();
    const location = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: location.href, assign },
    });
    onTestFinished(() => {
      Object.defineProperty(window, 'location', { configurable: true, value: location });
    });
    view({ filters: { from: '2026-10-01', to: '2026-10-18' } });
    fireEvent.keyDown(document.body, { key: 'e' });
    const dialog = await screen.findByRole('dialog', { name: en.export.title });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: en.export.confirm }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/api/audit/export?token=t');
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/audit/export');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      workspaceId: WORKSPACE.id,
      from: '2026-09-30T18:30:00.000Z',
      to: '2026-10-18T18:30:00.000Z',
      format: 'csv',
      bom: true,
    });
    expect(toast).toHaveBeenCalledWith(en.export.started);
  });

  it('tells the user when the export is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 403 }))),
    );
    view();
    fireEvent.click(screen.getByRole('button', { name: en.export.button }));
    const dialog = await screen.findByRole('dialog', { name: en.export.title });
    fireEvent.click(within(dialog).getByRole('button', { name: en.export.confirm }));
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(en.export.denied);
    });
  });
});

describe('audit filter params', () => {
  it('keeps valid filters and drops malformed ones', () => {
    expect(
      parseAuditFilters({
        from: '2026-10-05',
        to: '2026-10-01',
        actor: 'not-a-uuid',
        action: 'Member; drop',
      }),
    ).toEqual({ from: '2026-10-05' });
    expect(parseAuditFilters({ actor: OWNER_ID, action: 'member', to: ['2026-10-02'] })).toEqual({
      actor: OWNER_ID,
      action: 'member',
      to: '2026-10-02',
    });
  });

  it('turns IST days into instants with an exclusive upper bound', () => {
    expect(istDayStart('2026-10-01')).toBe('2026-09-30T18:30:00.000Z');
    expect(istDayAfter('2026-10-01')).toBe('2026-10-01T18:30:00.000Z');
    expect(auditFilterQuery({ from: '2026-10-01', action: 'member' })).toBe(
      'from=2026-10-01&action=member',
    );
  });
});
