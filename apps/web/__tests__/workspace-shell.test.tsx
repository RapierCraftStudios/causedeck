// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlaceholderRoute } from '../components/shell/placeholder-page.tsx';
import { getNavItem, WORKSPACE_ROUTES } from '../lib/nav.ts';
import { setErrorReporter, type ErrorReporter } from '../lib/report-error.ts';
import type { WorkspaceContextResult } from '../lib/workspace-context.ts';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';
import { TEST_USER } from './helpers/workspace.ts';

const state = vi.hoisted(
  (): {
    locale: TestLocale;
    dev: boolean;
    cookies: Record<string, { value: string }>;
    pathname: string;
    noWorkspaces: boolean;
    /** Flags the server evaluates on (#22); everything else is off, as on a fresh database. */
    flagsOn: string[];
    /** The owner 2FA policy state the layout reads (#290). */
    ownerTwoFactor: 'not-owner' | 'enabled' | 'grace' | 'required';
  } => ({
    locale: 'en',
    dev: true,
    cookies: {},
    pathname: '/w/demo/today',
    noWorkspaces: false,
    flagsOn: [],
    ownerTwoFactor: 'not-owner',
  }),
);

vi.mock('next/navigation', () => ({
  usePathname: () => '/w/demo/today',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations(state.locale)(namespace),
}));
vi.mock('../lib/env.ts', () => ({
  isDev: () => state.dev,
  serverEnv: () => ({ APP_URL: 'http://localhost:3000' }),
}));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: (name: string) => state.cookies[name] }),
  headers: () => Promise.resolve(new Headers({ 'x-pathname': state.pathname })),
}));
// The loader reads the session and the database (#179); here it answers from the test fixture:
// the user owns `demo`, is `clerk` of `clerk-desk`, `old-demo` is a renamed slug of `demo`.
vi.mock('../lib/workspace-loader.ts', async () => {
  const { testWorkspaceContext, TEST_MEMBERSHIPS } = await import('./helpers/workspace.ts');
  const getWorkspaceResult = (slug: string): Promise<WorkspaceContextResult> => {
    if (state.noWorkspaces) return Promise.resolve({ kind: 'no-workspaces' });
    if (slug === 'old-demo') return Promise.resolve({ kind: 'redirect', slug: 'demo' });
    const member = TEST_MEMBERSHIPS.some((m) => m.workspace.slug === slug);
    return Promise.resolve(
      member ? { kind: 'ok', context: testWorkspaceContext(slug) } : { kind: 'not-found' },
    );
  };
  return {
    getWorkspaceResult,
    getWorkspaceContext: async (slug: string) => {
      const result = await getWorkspaceResult(slug);
      return result.kind === 'ok' ? result.context : null;
    },
  };
});

// The owner's active support session (#313), read through the runtime seam; here a fixture.
const support = vi.hoisted(() => ({
  active: null as { id: string; expiresAt: Date } | null,
  fail: false,
  activeSupportSessionIn: vi.fn(),
  revoke: vi.fn(),
}));
// The workspace deletion in its cool-off (#305), read through the runtime seam; here a fixture.
const deletion = vi.hoisted(() => ({
  active: null as { id: string; status: string; cooloffUntil: Date | null } | null,
}));
vi.mock('@causedeck/core/runtime', () => ({
  activeSupportSessionIn: support.activeSupportSessionIn,
  activeWorkspaceDeletionIn: () => Promise.resolve(deletion.active),
}));
vi.mock('../app/(app)/w/[slug]/settings/support/actions.ts', () => ({
  revokeSupportSessionAction: support.revoke,
}));

// Flags are evaluated by `@causedeck/flags` against the database (#22); here from `state.flagsOn`.
vi.mock('../lib/flags.ts', async () => {
  const { defaultSnapshot } = await import('@causedeck/flags/keys');
  const snapshot = () => ({
    ...defaultSnapshot(),
    ...Object.fromEntries(state.flagsOn.map((key) => [key, true])),
  });
  return {
    getWorkspaceFlags: () => Promise.resolve(snapshot()),
    requireWorkspaceFlag: (key: string) => {
      if (!state.flagsOn.includes(key)) throw new Error('NEXT_NOT_FOUND');
      return Promise.resolve();
    },
  };
});

// The owner 2FA state comes from the session and the member row (#290); here from `state`.
vi.mock('../lib/require-2fa-for-owners.ts', () => ({
  loadOwnerTwoFactorState: () => Promise.resolve(state.ownerTwoFactor),
}));

const { default: WorkspaceLayout } = await import('../app/(app)/w/[slug]/layout.tsx');
const { default: WorkspaceError } = await import('../app/(app)/w/[slug]/error.tsx');
const { default: WorkspaceLoading } = await import('../app/(app)/w/[slug]/loading.tsx');
const { default: WorkspaceNotFound } = await import('../app/(app)/w/[slug]/not-found.tsx');
const { EMPTY_ACTION_TARGET, placeholderPage } =
  await import('../components/shell/placeholder-page.tsx');

type PageComponent = ReturnType<typeof placeholderPage>;

const PAGES: Record<PlaceholderRoute, PageComponent> = {
  today: (await import('../app/(app)/w/[slug]/today/page.tsx')).default,
  tomorrow: (await import('../app/(app)/w/[slug]/tomorrow/page.tsx')).default,
  calendar: (await import('../app/(app)/w/[slug]/calendar/page.tsx')).default,
  inbox: (await import('../app/(app)/w/[slug]/inbox/page.tsx')).default,
  matters: (await import('../app/(app)/w/[slug]/matters/page.tsx')).default,
  briefs: (await import('../app/(app)/w/[slug]/briefs/page.tsx')).default,
  obligations: (await import('../app/(app)/w/[slug]/obligations/page.tsx')).default,
  drafts: (await import('../app/(app)/w/[slug]/drafts/page.tsx')).default,
  memory: (await import('../app/(app)/w/[slug]/memory/page.tsx')).default,
  people: (await import('../app/(app)/w/[slug]/people/page.tsx')).default,
  // The courts index since #399, not a placeholder.
  courts: (await import('../app/(app)/w/[slug]/courts/page.tsx')).default,
  activity: (await import('../app/(app)/w/[slug]/activity/page.tsx')).default,
  billing: (await import('../app/(app)/w/[slug]/billing/page.tsx')).default,
  invoices: (await import('../app/(app)/w/[slug]/invoices/page.tsx')).default,
  limitation: (await import('../app/(app)/w/[slug]/limitation/page.tsx')).default,
  insights: (await import('../app/(app)/w/[slug]/insights/page.tsx')).default,
  // A redirect to the first settings section since #284, not a placeholder.
  settings: (await import('../app/(app)/w/[slug]/settings/page.tsx'))
    .default as unknown as PageComponent,
};

type PlaceholderId = PlaceholderRoute;
/** Routes whose page is no longer a placeholder; each has its own page test. */
const REAL_PAGES: ReadonlySet<PlaceholderId> = new Set<PlaceholderId>([
  'billing',
  'activity',
  'settings',
  // Its own page test since #399 (courts-page.test.tsx).
  'courts',
]);
const PLACEHOLDER_ROUTES: readonly PlaceholderId[] = WORKSPACE_ROUTES.filter(
  (route) => !REAL_PAGES.has(route),
);
const FLAGGED = new Set(['invoices', 'limitation']);

/** Flagged pages rebuilt with the flag on, so every route can be rendered. */
function pageFor(route: PlaceholderId): PageComponent {
  return FLAGGED.has(route) ? placeholderPage(route, { isEnabled: () => true }) : PAGES[route];
}

const props = (slug: string, query: Record<string, string> = {}) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve(query),
});

const withIntl = (ui: ReactElement, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

let online = true;
let reporter: ReturnType<typeof vi.fn<ErrorReporter>>;

beforeEach(() => {
  state.locale = 'en';
  state.dev = true;
  state.cookies = {};
  state.pathname = '/w/demo/today';
  state.noWorkspaces = false;
  state.flagsOn = [];
  state.ownerTwoFactor = 'not-owner';
  support.active = null;
  support.fail = false;
  support.activeSupportSessionIn.mockImplementation(() =>
    support.fail ? Promise.reject(new Error('db down')) : Promise.resolve(support.active),
  );
  support.revoke.mockResolvedValue({ ok: true, data: { sessionId: 's1', status: 'ended' } });
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  reporter = vi.fn<ErrorReporter>();
  setErrorReporter(reporter);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('support session banner (#313)', () => {
  const SESSION_ID = '00000000-0000-4000-8000-0000000e0001';
  // 09:00 UTC is 14:30 in Asia/Kolkata, the provider's time zone.
  const until = () => new Date(Date.now() + 60 * 60_000);

  async function renderLayout(slug = 'demo') {
    withIntl(
      await WorkspaceLayout({ children: <p>content</p>, params: Promise.resolve({ slug }) }),
    );
  }

  it('shows the owner `Support is viewing this workspace until HH:MM` above the page', async () => {
    const expiresAt = until();
    support.active = { id: SESSION_ID, expiresAt };
    await renderLayout();
    const banner = document.querySelector('[data-slot="support-banner"]');
    const time = new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Kolkata',
    }).format(expiresAt);
    expect(banner?.textContent).toContain(`Support is viewing this workspace until ${time}`);
    expect(banner?.getAttribute('role')).toBe('status');
    // Between the topbar and main, never inside the page.
    expect(document.getElementById('main')?.contains(banner ?? null)).toBe(false);
    expect(support.activeSupportSessionIn).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: TEST_USER.id,
    });
  });

  it('formats the end time as 14:30 for a grant ending at 09:00 UTC', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T08:00:00Z'), toFake: ['Date'] });
    try {
      support.active = { id: SESSION_ID, expiresAt: new Date('2026-10-20T09:00:00Z') };
      await renderLayout();
      expect(screen.getByText('Support is viewing this workspace until 14:30')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('`End session` revokes in one click and the banner goes at once', async () => {
    support.active = { id: SESSION_ID, expiresAt: until() };
    await renderLayout();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'End session' }));
      await Promise.resolve();
    });
    expect(support.revoke).toHaveBeenCalledWith({ workspaceId: 'ws-1', sessionId: SESSION_ID });
    expect(document.querySelector('[data-slot="support-banner"]')).toBeNull();
  });

  it('keeps the banner with an error when ending fails', async () => {
    support.active = { id: SESSION_ID, expiresAt: until() };
    support.revoke.mockResolvedValue({ ok: false, error: { code: 'INTERNAL', message: 'x' } });
    await renderLayout();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'End session' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('alert').textContent).toBe('Could not end the session. Try again.');
    expect(document.querySelector('[data-slot="support-banner"]')).not.toBeNull();
  });

  it('shows no banner without an active session, for non-owners, or when the read fails', async () => {
    await renderLayout();
    expect(document.querySelector('[data-slot="support-banner"]')).toBeNull();

    cleanup();
    support.active = { id: SESSION_ID, expiresAt: until() };
    support.activeSupportSessionIn.mockClear();
    await renderLayout('clerk-desk');
    expect(document.querySelector('[data-slot="support-banner"]')).toBeNull();
    expect(support.activeSupportSessionIn).not.toHaveBeenCalled();

    cleanup();
    support.fail = true;
    await renderLayout();
    expect(document.querySelector('[data-slot="support-banner"]')).toBeNull();
    expect(document.getElementById('main')?.textContent).toBe('content');
  });

  it('removes itself when the grant runs out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      support.active = { id: SESSION_ID, expiresAt: new Date(Date.now() + 5 * 60_000) };
      await renderLayout();
      expect(document.querySelector('[data-slot="support-banner"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(5 * 60_000 + 1);
      });
      expect(document.querySelector('[data-slot="support-banner"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('workspace layout', () => {
  it('calls notFound and never renders children for a non-member workspace', async () => {
    const children = vi.fn(() => <p>secret matter</p>);
    const Child = children;
    for (const slug of ['other-chambers', 'unknown']) {
      await expect(
        WorkspaceLayout({ children: <Child />, params: Promise.resolve({ slug }) }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
    }
    expect(children).not.toHaveBeenCalled();
  });

  it('redirects an old slug to the same page on the current slug', async () => {
    state.pathname = '/w/old-demo/matters?stage=filed';
    await expect(
      WorkspaceLayout({ children: <p />, params: Promise.resolve({ slug: 'old-demo' }) }),
    ).rejects.toThrow('NEXT_REDIRECT /w/demo/matters?stage=filed');
  });

  it('sends a user with no workspace to onboarding', async () => {
    state.noWorkspaces = true;
    await expect(
      WorkspaceLayout({ children: <p />, params: Promise.resolve({ slug: 'demo' }) }),
    ).rejects.toThrow('NEXT_REDIRECT /onboarding');
  });

  it('renders children inside main#main for a member', async () => {
    withIntl(
      await WorkspaceLayout({
        children: <p>content</p>,
        params: Promise.resolve({ slug: 'demo' }),
      }),
    );
    const main = document.getElementById('main');
    expect(main?.tagName).toBe('MAIN');
    expect(main?.dataset.workspaceSlug).toBe('demo');
    expect(main?.textContent).toBe('content');
    expect(document.querySelectorAll('main')).toHaveLength(1);
  });

  it('wraps the page in the shell chrome: header and nav[aria-label=Primary]', async () => {
    withIntl(
      await WorkspaceLayout({
        children: <p>content</p>,
        params: Promise.resolve({ slug: 'demo' }),
      }),
    );
    expect(screen.getByRole('banner').tagName).toBe('HEADER');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
    expect(document.querySelector('[data-shell]')?.getAttribute('data-sidebar')).toBe('auto');
  });

  it('shows the persistent owner 2FA banner only once the grace has run out (#290)', async () => {
    const banner = async () => {
      cleanup();
      withIntl(
        await WorkspaceLayout({
          children: <p>content</p>,
          params: Promise.resolve({ slug: 'demo' }),
        }),
      );
      return document.querySelector('[data-slot="owner-two-factor-banner"]');
    };
    for (const quiet of ['not-owner', 'enabled', 'grace'] as const) {
      state.ownerTwoFactor = quiet;
      expect(await banner()).toBeNull();
    }
    state.ownerTwoFactor = 'required';
    const shown = await banner();
    expect(shown?.getAttribute('role')).toBe('status');
    expect(shown?.textContent).toContain('Turn on two-factor authentication');
    expect(shown?.querySelector('a')?.getAttribute('href')).toBe('/account#two-factor');
    // Above the page content, outside main#main.
    expect(document.getElementById('main')?.contains(shown ?? null)).toBe(false);
  });

  it('shows the cool-off banner to every member while a deletion waits (#305)', async () => {
    const banner = async (slug: string) => {
      cleanup();
      withIntl(
        await WorkspaceLayout({ children: <p>content</p>, params: Promise.resolve({ slug }) }),
      );
      return document.querySelector('[data-slot="cooloff-banner"]');
    };
    deletion.active = null;
    expect(await banner('demo')).toBeNull();
    deletion.active = {
      id: '00000000-0000-4000-8000-0000000d0001',
      status: 'pending_cooloff',
      cooloffUntil: new Date('2026-04-01T06:00:00Z'),
    };
    // The owner gets the link to the danger zone, where the cancel runs after step-up.
    const owner = await banner('demo');
    expect(owner?.textContent).toContain('Scheduled for deletion on');
    expect(owner?.textContent).toContain('Cancel any time before then.');
    expect(owner?.querySelector('a')?.getAttribute('href')).toBe('/w/demo/settings/danger');
    // Under the topbar, outside main#main.
    expect(document.getElementById('main')?.contains(owner ?? null)).toBe(false);
    // A clerk sees the banner without the cancel link.
    const clerk = await banner('clerk-desk');
    expect(clerk?.textContent).toContain('Scheduled for deletion on');
    expect(clerk?.querySelector('a')).toBeNull();
    deletion.active = null;
  });

  it('shows the demo-data banner in the demo workspace only, to every member (#182)', async () => {
    const banner = async (slug: string) => {
      cleanup();
      withIntl(
        await WorkspaceLayout({ children: <p>content</p>, params: Promise.resolve({ slug }) }),
      );
      return document.querySelector('[data-slot="demo-banner"]');
    };
    const demo = await banner('demo');
    expect(demo?.textContent).toContain('Demo data — fictional');
    expect(demo?.getAttribute('role')).toBe('status');
    // Above the page content, outside main#main.
    expect(document.getElementById('main')?.contains(demo ?? null)).toBe(false);
    expect(await banner('clerk-desk')).toBeNull();
  });

  it('paints the sidebar state from the cookie', async () => {
    state.cookies = { sidebar: { value: 'collapsed' } };
    withIntl(
      await WorkspaceLayout({
        children: <p>content</p>,
        params: Promise.resolve({ slug: 'demo' }),
      }),
    );
    expect(document.querySelector('[data-shell]')?.getAttribute('data-sidebar')).toBe('collapsed');
  });

  it('hides the invoices and limitation nav items while their flags are off', async () => {
    const navHrefs = async () => {
      cleanup();
      withIntl(
        await WorkspaceLayout({ children: <p />, params: Promise.resolve({ slug: 'demo' }) }),
      );
      const nav = screen.getByRole('navigation', { name: 'Primary' });
      return [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    };
    const off = await navHrefs();
    expect(off).toContain('/w/demo/today');
    expect(off).not.toContain('/w/demo/invoices');
    expect(off).not.toContain('/w/demo/limitation');

    state.flagsOn = ['invoices.enabled', 'limitation.enabled'];
    const on = await navHrefs();
    expect(on).toContain('/w/demo/invoices');
    expect(on).toContain('/w/demo/limitation');
  });

  it('placeholder pages refuse a non-member workspace on their own', async () => {
    await expect(PAGES.today(props('other-chambers'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('placeholder pages', () => {
  it('exist for every workspace route, settings included', () => {
    const dir = path.join(import.meta.dirname, '../app/(app)/w/[slug]');
    for (const route of WORKSPACE_ROUTES) {
      expect(existsSync(path.join(dir, route, 'page.tsx')), route).toBe(true);
    }
    expect(Object.keys(PAGES).sort()).toEqual([...WORKSPACE_ROUTES].sort());
  });

  it.each(PLACEHOLDER_ROUTES)('%s renders its title and designed empty state', async (route) => {
    withIntl(await pageFor(route)(props('demo')));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(catalogs.en.nav[route]);
    const empty = document.querySelector('[data-pattern-state="empty"]');
    expect(empty?.textContent).toContain(catalogs.en.shell.pages[route].empty);
    expect(screen.getByText(catalogs.en.shell.pages[route].description)).toBeTruthy();
  });

  it.each(PLACEHOLDER_ROUTES)(
    '%s empty state has an icon, a one-line hint and a primary action to a real page',
    async (route) => {
      withIntl(await pageFor(route)(props('demo')));
      const empty = document.querySelector('[data-pattern-state="empty"]');
      expect(empty?.querySelector('[data-slot="empty-state-icon"] svg')).not.toBeNull();
      expect(empty?.querySelector('[data-slot="empty-state-description"]')?.textContent).toBe(
        catalogs.en.shell.pages[route].hint,
      );
      const action = empty?.querySelector('[data-slot="empty-state-actions"] a');
      const target = EMPTY_ACTION_TARGET[route];
      expect(action?.getAttribute('href')).toBe(
        target === 'account' ? '/account' : `/w/demo/${target}`,
      );
      expect(action?.textContent).toMatch(/^Go to /);
      // The target is a page every role can open: no permission, no flag.
      if (target !== 'account') {
        const item = getNavItem(target);
        expect(item.requires).toBeUndefined();
        expect(item.flag).toBeUndefined();
      }
    },
  );

  it('uses the #11 design-spec empty copy verbatim', async () => {
    const spec: Partial<Record<PlaceholderId, string>> = {
      today: 'No hearings today. Forward a cause list to see your court day.',
      inbox: 'Your inbox is clear.',
      matters: 'No matters yet. Import or add your first matter.',
      obligations: 'No open obligations.',
    };
    for (const [route, copy] of Object.entries(spec)) {
      withIntl(await pageFor(route as PlaceholderId)(props('demo')));
      expect(document.querySelector('[data-slot="empty-state-title"]')?.textContent).toBe(copy);
      cleanup();
    }
  });

  it.each(PLACEHOLDER_ROUTES)(
    '%s shows the loading skeleton under ?__state=loading in dev',
    async (route) => {
      withIntl(await pageFor(route)(props('demo', { __state: 'loading' })));
      expect(screen.getByRole('status').textContent).toContain(catalogs.en.shell.loading);
      expect(document.querySelector('[data-slot="route-skeleton"]')).not.toBeNull();
      expect(document.querySelector('[data-pattern-state="empty"]')).toBeNull();
    },
  );

  it.each(PLACEHOLDER_ROUTES)(
    '%s throws to the error boundary under ?__state=error in dev',
    async (route) => {
      await expect(pageFor(route)(props('demo', { __state: 'error' }))).rejects.toThrow();
    },
  );

  it('ignores the __state toggle outside development', async () => {
    state.dev = false;
    withIntl(await PAGES.today(props('demo', { __state: 'loading' })));
    expect(document.querySelector('[data-slot="route-skeleton"]')).toBeNull();
    expect(document.querySelector('[data-pattern-state="empty"]')).not.toBeNull();
    cleanup();
    await expect(PAGES.today(props('demo', { __state: 'error' }))).resolves.toBeTruthy();
  });

  it.each(['invoices', 'limitation', 'insights'] as const)(
    '%s renders permission-denied when the stub role lacks permission',
    async (route) => {
      withIntl(await pageFor(route)(props('clerk-desk')));
      const denied = document.querySelector('[data-pattern-state="permission-denied"]');
      expect(denied?.textContent).toContain('You do not have access to this area.');
      expect(screen.getByRole('button', { name: 'Request access' })).toBeTruthy();
      expect(document.querySelector('[data-pattern-state="empty"]')).toBeNull();
    },
  );

  it('billing (#256) tells roles without billing.read that only owners manage billing', async () => {
    withIntl(await PAGES.billing(props('clerk-desk')));
    const denied = document.querySelector('[data-pattern-state="permission-denied"]');
    expect(denied?.textContent).toContain('Only workspace owners can manage billing.');
    expect(document.querySelector('[data-pattern-state="empty"]')).toBeNull();
  });

  it('keeps flagged pages behind notFound while the flag is off (the default)', async () => {
    await expect(PAGES.invoices(props('demo'))).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(PAGES.limitation(props('demo'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('serves flagged pages once the server evaluates their flag on', async () => {
    state.flagsOn = ['invoices.enabled'];
    withIntl(await PAGES.invoices(props('demo')));
    expect(document.querySelector('[data-route="invoices"]')).not.toBeNull();
    await expect(PAGES.limitation(props('demo'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('shows the offline banner only while navigator.onLine is false', async () => {
    online = false;
    withIntl(await PAGES.today(props('demo')));
    const banner = () => document.querySelector('[data-pattern-state="offline"]');
    expect(banner()?.textContent).toContain('You are offline.');

    online = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(banner()).toBeNull();

    online = false;
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(banner()).not.toBeNull();
  });

  it('renders no offline banner when online', async () => {
    withIntl(await PAGES.inbox(props('demo')));
    expect(document.querySelector('[data-pattern-state="offline"]')).toBeNull();
  });
});

describe('workspace boundaries', () => {
  function leakyError(): Error & { digest?: string } {
    const error: Error & { digest?: string } = new Error('SELECT secret FROM matters');
    error.digest = 'd1g35t';
    return error;
  }

  it('error.tsx shows the designed copy and digest, never the message, and retries', () => {
    const reset = vi.fn();
    const error = leakyError();
    withIntl(<WorkspaceError error={error} reset={reset} />);

    expect(document.querySelector('[data-pattern-state="error"]')?.textContent).toContain(
      'Something went wrong loading this page.',
    );
    expect(document.body.textContent).toContain('d1g35t');
    expect(document.body.textContent).not.toContain('SELECT');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledOnce();
    expect(reporter).toHaveBeenCalledWith(error, { boundary: 'route', digest: 'd1g35t' });
  });

  it('error.tsx copies the error ID', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    withIntl(<WorkspaceError error={leakyError()} reset={() => undefined} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy error ID' }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('d1g35t');
    expect(screen.getByRole('button', { name: 'Error ID copied' })).toBeTruthy();
  });

  it('loading.tsx renders the route skeleton', () => {
    withIntl(<WorkspaceLoading />);
    expect(screen.getByRole('status').textContent).toContain('Loading');
  });

  it('not-found.tsx renders the not-found state without workspace data', () => {
    withIntl(<WorkspaceNotFound />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    expect(document.querySelector('[data-pattern-state="not-found"]')).not.toBeNull();
  });
});

describe('settings and account', () => {
  it('settings redirects to the workspace profile, the first settings section (#284)', async () => {
    await expect(PAGES.settings(props('demo'))).rejects.toThrow(
      'NEXT_REDIRECT /w/demo/settings/profile',
    );
  });

  it('settings lands a clerk, who holds settings.read (viewers do not), on the profile too', async () => {
    const { can } = await import('../lib/workspace-context.ts');
    expect(can('viewer', 'settings.read')).toBe(false);
    expect(can('clerk', 'settings.read')).toBe(true);
    await expect(PAGES.settings(props('clerk-desk'))).rejects.toThrow(
      'NEXT_REDIRECT /w/clerk-desk/settings/profile',
    );
  });

  it('settings refuses a non-member workspace', async () => {
    await expect(PAGES.settings(props('other-chambers'))).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('localised strings', () => {
  /** Every en string under nav and shell that differs from its ta stub. */
  function enOnly(en: unknown, ta: unknown): string[] {
    if (typeof en === 'string') return en !== ta ? [en] : [];
    if (typeof en !== 'object' || en === null) return [];
    return Object.entries(en).flatMap(([key, child]) =>
      enOnly(child, (ta as Record<string, unknown>)[key]),
    );
  }
  const leaks = [
    ...enOnly(catalogs.en.nav, catalogs.ta.nav),
    ...enOnly(catalogs.en.shell, catalogs.ta.shell),
  ].filter((text) => text.length > 3);

  it.each(PLACEHOLDER_ROUTES)('%s renders only ta strings under the ta catalog', async (route) => {
    state.locale = 'ta';
    online = false;
    withIntl(await pageFor(route)(props('demo')), 'ta');
    const text = document.body.textContent;
    expect(text).toContain(catalogs.ta.shell.pages[route].empty);
    for (const leak of leaks) expect(text).not.toContain(leak);
  });

  it('permission-denied and error screens render ta strings', async () => {
    state.locale = 'ta';
    withIntl(await pageFor('insights')(props('clerk-desk')), 'ta');
    withIntl(<WorkspaceError error={new Error('x')} reset={() => undefined} />, 'ta');
    const text = document.body.textContent;
    expect(text).toContain(catalogs.ta.shell.permissionDenied.message);
    expect(text).toContain(catalogs.ta.shell.error.description);
    for (const leak of leaks) expect(text).not.toContain(leak);
  });
});
