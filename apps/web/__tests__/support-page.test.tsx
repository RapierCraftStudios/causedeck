// @vitest-environment jsdom
// `/w/[slug]/settings/support` (#313): the owner-only page (permission-denied for every other
// role), the plain-language scope explanation, pending requests with `Grant for 1 hour` (or a 2 h /
// 4 h length) and `Deny`, active sessions with `Revoke now` and no extend control, and the empty,
// error and offline states. Every string comes from the catalogs.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupportRequestsActions } from '../app/(app)/w/[slug]/settings/support/support-requests.tsx';
import type { Role, WorkspaceContext } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';
import { testWorkspaceContext } from './helpers/workspace.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  rows: [] as unknown[],
  fail: false,
}));
const loadSupportPage = vi.hoisted(() => vi.fn());
const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('@causedeck/ui/sonner', () => ({ toast }));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () => Promise.resolve(page.context),
}));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('@causedeck/core/runtime', () => ({ loadSupportPage }));
vi.mock('../app/(app)/w/[slug]/settings/support/actions.ts', () => ({
  grantSupportSessionAction: vi.fn(),
  denySupportSessionAction: vi.fn(),
  revokeSupportSessionAction: vi.fn(),
}));

const { default: SupportPage } = await import('../app/(app)/w/[slug]/settings/support/page.tsx');
const { SupportRequests } =
  await import('../app/(app)/w/[slug]/settings/support/support-requests.tsx');

const en = catalogs.en.settings.support;
const WS = '00000000-0000-4000-8000-00000000a001';
const PENDING = '00000000-0000-4000-8000-0000000e0001';
const ACTIVE = '00000000-0000-4000-8000-0000000e0002';

const withIntl = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

function setOnline(online: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}

const asRole = (role: Role) => {
  page.context = testWorkspaceContext('demo', role);
};

const dbRow = (overrides: Record<string, unknown>) => ({
  workspaceId: WS,
  requestedByStaff: '00000000-0000-4000-8000-0000000f0001',
  grantedByUser: null,
  scope: 'view',
  reason: 'Customer reported a sync issue',
  status: 'requested',
  createdAt: new Date('2026-10-20T07:00:00Z'),
  grantedAt: null,
  expiresAt: null,
  endedAt: null,
  ...overrides,
});

beforeEach(() => {
  asRole('owner');
  page.fail = false;
  page.rows = [];
  loadSupportPage.mockImplementation(() =>
    page.fail ? Promise.reject(new Error('db down')) : Promise.resolve(page.rows),
  );
  setOnline(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render the page, resolving the async list inside its Suspense boundary. */
async function renderPage() {
  const tree = (await SupportPage({ params: Promise.resolve({ slug: 'demo' }) })) as ReactElement<{
    children?: ReactNode;
  }>;
  const children = tree.props.children as ReactElement[] | undefined;
  if (!Array.isArray(children)) {
    withIntl(tree);
    return;
  }
  const [header, scope, suspense] = children as [
    ReactElement,
    ReactElement,
    ReactElement<{ children: ReactElement }>,
  ];
  const section = suspense.props.children;
  const Section = section.type as (props: unknown) => Promise<ReactNode>;
  const content = await Section(section.props);
  withIntl(
    <div>
      {header}
      {scope}
      {content}
    </div>,
  );
}

describe('support page (server)', () => {
  it('is not found without a workspace context', async () => {
    page.context = null;
    await expect(SupportPage({ params: Promise.resolve({ slug: 'demo' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it.each(['advocate', 'junior', 'clerk', 'viewer'] as const)(
    'a %s opening it directly gets the permission-denied page and nothing is read',
    async (role) => {
      asRole(role);
      await renderPage();
      expect(screen.getByText(catalogs.en.shell.permissionDenied.title)).toBeTruthy();
      expect(loadSupportPage).not.toHaveBeenCalled();
    },
  );

  it('explains the scope in plain language and lists pending and active sessions', async () => {
    page.rows = [
      dbRow({ id: PENDING }),
      dbRow({
        id: ACTIVE,
        status: 'granted',
        scope: 'metadata',
        grantedAt: new Date('2026-10-20T08:00:00Z'),
        expiresAt: new Date('2026-10-20T09:00:00Z'),
      }),
    ];
    await renderPage();
    expect(loadSupportPage).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: page.context?.user.id,
    });
    const scope = document.querySelector('[data-slot="support-scope"]');
    expect(scope?.textContent).toContain(en.scope.view);
    expect(scope?.textContent).toContain(en.scope.metadata);
    expect(scope?.textContent).toContain(en.scope.audit);

    const request = document.querySelector(`[data-session-id="${PENDING}"]`) as HTMLElement;
    expect(within(request).getByRole('button', { name: 'Grant for 1 hour' })).toBeTruthy();
    expect(within(request).getByRole('button', { name: en.deny })).toBeTruthy();
    expect(request.textContent).toContain('Reason: Customer reported a sync issue');

    const active = document.querySelector(`[data-session-id="${ACTIVE}"]`) as HTMLElement;
    // 09:00 UTC is 14:30 in Asia/Kolkata.
    expect(active.textContent).toContain('Until 14:30');
    expect(within(active).getByRole('button', { name: en.revoke })).toBeTruthy();
    // A grant is never extended: no grant or length control on an active session.
    expect(within(active).queryByRole('button', { name: /Grant/ })).toBeNull();
    expect(within(active).queryByRole('combobox')).toBeNull();
  });

  it('shows the empty state with no requests', async () => {
    await renderPage();
    expect(screen.getByText(en.empty.title)).toBeTruthy();
  });

  it('shows the error state when the list cannot load', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByText(en.error.title)).toBeTruthy();
    expect(logger.error).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.error.retry }));
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe('SupportRequests (client)', () => {
  const pending = {
    id: PENDING,
    scope: 'view' as const,
    reason: 'Sync issue',
    status: 'requested' as const,
    requestedAt: '2026-10-20T07:00:00Z',
    expiresAt: null,
  };
  const active = {
    ...pending,
    id: ACTIVE,
    status: 'granted' as const,
    expiresAt: '2026-10-20T09:00:00Z',
  };

  function actions(): SupportRequestsActions {
    return {
      grant: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { sessionId: PENDING, status: 'granted', expiresAt: '2026-10-20T09:00:00Z' },
        }),
      ),
      deny: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { sessionId: PENDING, status: 'denied', expiresAt: null },
        }),
      ),
      revoke: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          data: { sessionId: ACTIVE, status: 'ended', expiresAt: null },
        }),
      ),
    };
  }

  async function click(name: string | RegExp) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name }));
      await Promise.resolve();
    });
  }

  it('grants for 1 hour by default, then toasts the end time and refreshes', async () => {
    const a = actions();
    withIntl(<SupportRequests workspaceId={WS} sessions={[pending]} actions={a} />);
    await click('Grant for 1 hour');
    expect(a.grant).toHaveBeenCalledWith({ workspaceId: WS, sessionId: PENDING, minutes: 60 });
    expect(toast).toHaveBeenCalledWith('Support can view this workspace until 14:30.');
    expect(router.refresh).toHaveBeenCalled();
  });

  it('grants for the length the owner picks, up to 4 hours', async () => {
    const a = actions();
    withIntl(<SupportRequests workspaceId={WS} sessions={[pending]} actions={a} />);
    const select = screen.getByRole('combobox', { name: en.duration.label });
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '1 hour',
      '2 hours',
      '4 hours',
    ]);
    fireEvent.change(select, { target: { value: '240' } });
    await click('Grant for 4 hours');
    expect(a.grant).toHaveBeenCalledWith({ workspaceId: WS, sessionId: PENDING, minutes: 240 });
  });

  it('denies and revokes with one click each', async () => {
    const a = actions();
    withIntl(<SupportRequests workspaceId={WS} sessions={[pending, active]} actions={a} />);
    await click(en.deny);
    expect(a.deny).toHaveBeenCalledWith({ workspaceId: WS, sessionId: PENDING });
    expect(toast).toHaveBeenCalledWith(en.toast.denied);
    await click(en.revoke);
    expect(a.revoke).toHaveBeenCalledWith({ workspaceId: WS, sessionId: ACTIVE });
    expect(toast).toHaveBeenCalledWith(en.toast.revoked);
  });

  it('says why a stale request cannot be granted', async () => {
    const a = actions();
    vi.mocked(a.grant).mockResolvedValue({ ok: false, error: { code: 'CONFLICT', message: '' } });
    withIntl(<SupportRequests workspaceId={WS} sessions={[pending]} actions={a} />);
    await click('Grant for 1 hour');
    expect(toast).toHaveBeenCalledWith(en.errors.conflict);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('disables every action offline', () => {
    setOnline(false);
    withIntl(<SupportRequests workspaceId={WS} sessions={[pending, active]} actions={actions()} />);
    for (const name of ['Grant for 1 hour', en.deny, en.revoke]) {
      expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    }
  });
});
