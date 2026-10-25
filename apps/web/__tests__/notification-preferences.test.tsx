// @vitest-environment jsdom
// `/w/[slug]/settings/notifications` (#199): the server page (membership, workspace-scoped load of
// the caller's preferences, loading and error states) and the client form (category × channel
// matrix and 360 px cards, mandatory channels locked with the explanation, the digest selector,
// court-hours and lock-screen toggles, optimistic saves rolled back on failure). Every string
// comes from the catalogs, with ta/kn parity for the preferences keys.
import type { PreferenceView } from '../app/(app)/w/[slug]/settings/notifications/actions.ts';
import type { PreferencesActions } from '../app/(app)/w/[slug]/settings/notifications/preferences-form.tsx';
import type { WorkspaceContext } from '../lib/workspace-context.ts';

import {
  CATEGORY_KEYS as ALL_CATEGORY_KEYS,
  CHANNELS,
  isLockedChannel,
} from '@causedeck/notifications/categories';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs, fakeGetTranslations, type TestLocale } from './helpers/intl.ts';

/** The court-day reminders (#64) have their own card, not a matrix row. */
const CATEGORY_KEYS = ALL_CATEGORY_KEYS.filter(
  (key) => !key.startsWith('reminder.') || key === 'reminder.hearing',
);

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const page = vi.hoisted(() => ({
  context: null as WorkspaceContext | null,
  dev: true,
  fail: false,
}));
const withWorkspace = vi.hoisted(() =>
  vi.fn((_db: unknown, _scope: unknown, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ scoped: true }),
  ),
);
const service = vi.hoisted(() => ({
  getPreferences: vi.fn(),
  getDigest: vi.fn(() => Promise.resolve('daily')),
  getNotificationSetting: vi.fn(() =>
    Promise.resolve({ courtHoursQuiet: true, lockScreenDetails: false }),
  ),
}));
const logger = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
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
vi.mock('../lib/env.ts', () => ({
  isDev: () => page.dev,
  serverEnv: () => ({ VAPID_PUBLIC_KEY: 'test-vapid-public', VAPID_PRIVATE_KEY: 'test-private' }),
}));
vi.mock('@causedeck/notifications/push', () => ({
  pushConfig: (env: { VAPID_PUBLIC_KEY?: string }) =>
    env.VAPID_PUBLIC_KEY ? { publicKey: env.VAPID_PUBLIC_KEY } : null,
}));
// The push card (#197) moved here from the old settings index (#284).
vi.mock('../components/notifications/push-permission-card.tsx', () => ({
  PushPermissionCard: ({ vapidPublicKey }: { vapidPublicKey: string | null }) => (
    <div data-slot="push-card" data-key={vapidPublicKey ?? ''} />
  ),
}));
vi.mock('../src/health.ts', () => ({ logger }));
vi.mock('../components/shell/offline-banner.tsx', () => ({ ShellOfflineBanner: () => null }));
vi.mock('@causedeck/db', () => ({ db: { fake: 'db' }, withWorkspace }));
vi.mock('@causedeck/notifications', () => service);
vi.mock('../app/(app)/w/[slug]/settings/notifications/actions.ts', () => ({
  setNotificationPreferenceAction: vi.fn(),
  setNotificationDigestAction: vi.fn(),
  setCourtHoursQuietAction: vi.fn(),
  setLockScreenDetailsAction: vi.fn(),
}));

const { PreferencesForm } =
  await import('../app/(app)/w/[slug]/settings/notifications/preferences-form.tsx');
const { default: PreferencesPage } =
  await import('../app/(app)/w/[slug]/settings/notifications/page.tsx');

const en = catalogs.en.notifications.preferences;
const WORKSPACE = {
  id: '00000000-0000-4000-8000-00000000a001',
  slug: 'chennai-solo',
  name: 'Iyer Chambers',
};

/** The resolved matrix as the service returns it with no preference rows. */
function defaults(): PreferenceView[] {
  const defaultsOn: Record<string, readonly string[]> = {
    'workspace.invite': ['in_app', 'email'],
    'member.joined': ['in_app'],
    'security.alert': ['in_app', 'email', 'push'],
    'billing.notice': ['in_app', 'email'],
    'reminder.hearing': ['in_app', 'email', 'push'],
    'court.board': ['in_app', 'push'],
    'proposal.new': ['in_app', 'push'],
    'judgment.alert': ['in_app', 'push'],
    'status.next_date': ['in_app', 'push'],
    'status.order': ['in_app', 'push'],
    'status.stage': ['in_app', 'push'],
    notices: ['in_app', 'push'],
    'digest.daily': ['email'],
    'digest.end_of_day': ['in_app', 'email'],
    'digest.news': ['in_app', 'email', 'push'],
    'reminder.evening': ['in_app', 'email', 'push'],
    'reminder.morning': ['in_app', 'email', 'push'],
    'reminder.outcome_missing': ['in_app', 'email', 'push'],
    'system.notice': ['in_app'],
  };
  return ALL_CATEGORY_KEYS.flatMap((category) =>
    CHANNELS.map((channel) => ({
      category,
      channel,
      enabled: defaultsOn[category]?.includes(channel) ?? false,
      digest: 'instant' as const,
      locked: isLockedChannel(category, channel),
    })),
  );
}

const ok = <T,>(data: T) => Promise.resolve({ ok: true as const, data });
const fail = () =>
  Promise.resolve({ ok: false as const, error: { code: 'INTERNAL' as const, message: '' } });

function fakeActions(): { [K in keyof PreferencesActions]: ReturnType<typeof vi.fn> } {
  return {
    setPreference: vi.fn((input: PreferenceView) =>
      ok({ ...input, digest: 'instant', locked: false }),
    ),
    setDigest: vi.fn((input: { digest: string }) => ok({ digest: input.digest })),
    setCourtHoursQuiet: vi.fn((input: { enabled: boolean }) =>
      ok({ courtHoursQuiet: input.enabled, lockScreenDetails: false }),
    ),
    setLockScreenDetails: vi.fn((input: { enabled: boolean }) =>
      ok({ courtHoursQuiet: false, lockScreenDetails: input.enabled }),
    ),
  };
}

const withIntl = (ui: ReactNode, locale: TestLocale = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

interface FormOptions {
  actions?: ReturnType<typeof fakeActions>;
  locale?: TestLocale;
  preferences?: PreferenceView[];
}

function form({
  actions = fakeActions(),
  locale = 'en',
  preferences = defaults(),
}: FormOptions = {}) {
  withIntl(
    <PreferencesForm
      workspaceId={WORKSPACE.id}
      preferences={preferences}
      digest="instant"
      settings={{ courtHoursQuiet: false, lockScreenDetails: false }}
      actions={actions}
    />,
    locale,
  );
  return actions;
}

const matrix = () => {
  const el = document.querySelector<HTMLElement>('[data-slot="preferences-matrix"]');
  if (!el) throw new Error('no matrix');
  return el;
};
const cards = () => {
  const el = document.querySelector<HTMLElement>('[data-slot="preferences-cards"]');
  if (!el) throw new Error('no cards');
  return el;
};
const cell = (scope: HTMLElement, label: string, channel: string) =>
  within(scope).getByRole('switch', { name: `${label}: ${channel}` });

beforeEach(() => {
  page.context = {
    user: { id: 'u-owner', name: 'Meenakshi Iyer', email: 'owner@x.test' },
    workspace: WORKSPACE,
    role: 'owner',
  } as unknown as WorkspaceContext;
  page.dev = true;
  page.fail = false;
  service.getPreferences.mockImplementation(() =>
    page.fail ? Promise.reject(new Error('db down')) : Promise.resolve(defaults()),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render the page, resolving the async preferences section inside its Suspense boundary. */
async function renderPage(search: Record<string, string> = {}) {
  const tree = (await PreferencesPage({
    params: Promise.resolve({ slug: WORKSPACE.slug }),
    searchParams: Promise.resolve(search),
  })) as ReactElement<{
    children: [ReactElement, ReactElement<{ children?: unknown }>, ReactElement, ReactElement];
  }>;
  // children: header, preferences, reminders card (#64), push card, WhatsApp.
  const [header, body, , push] = tree.props.children;
  const section = (body.props as { children?: ReactElement }).children;
  let content: ReactNode = body;
  if (section && typeof section.type === 'function') {
    const Section = section.type as (props: unknown) => Promise<ReactNode>;
    content = await Section(section.props);
  }
  withIntl(
    <div>
      {header}
      {content}
      {push}
    </div>,
  );
}

describe('notification preferences page (server)', () => {
  it('is not found for a non-member', async () => {
    page.context = null;
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('loads the caller own preferences on the workspace transaction', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.title);
    expect(withWorkspace).toHaveBeenCalledWith(
      { fake: 'db' },
      { workspaceId: WORKSPACE.id, userId: 'u-owner' },
      expect.any(Function),
    );
    const ctx = { db: { scoped: true }, workspaceId: WORKSPACE.id };
    expect(service.getPreferences).toHaveBeenCalledWith(ctx, { userId: 'u-owner' });
    expect(service.getDigest).toHaveBeenCalledWith(ctx, { userId: 'u-owner' });
    expect(service.getNotificationSetting).toHaveBeenCalledWith(ctx, { userId: 'u-owner' });
    // The loaded digest and settings are what the form shows.
    expect(screen.getByRole('radio', { name: en.digest.daily }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(
      screen.getByRole('switch', { name: en.courtHours.label }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('hosts the push permission card with the VAPID public key (#284)', async () => {
    await renderPage();
    expect(document.querySelector('[data-slot="push-card"]')?.getAttribute('data-key')).toBe(
      'test-vapid-public',
    );
  });

  it('shows the error state with Try again when loading fails', async () => {
    page.fail = true;
    await renderPage();
    expect(screen.getByRole('alert').textContent).toContain(en.loadError);
    fireEvent.click(screen.getByRole('button', { name: en.retry }));
    expect(router.refresh).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('previews the loading and error states in development only', async () => {
    await renderPage({ __state: 'loading' });
    expect(document.querySelector('[data-slot="preferences-skeleton"]')).not.toBeNull();
    cleanup();
    page.dev = false;
    await renderPage({ __state: 'error' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('PreferencesForm', () => {
  it('shows a row and a card per category, without the digest email row', () => {
    form();
    const rows = matrix().querySelectorAll('tbody tr');
    expect([...rows].map((r) => r.getAttribute('data-category'))).toEqual(
      CATEGORY_KEYS.filter((k) => k !== 'digest.daily'),
    );
    expect(
      within(matrix())
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([en.categoryHeader, en.channels.inApp, en.channels.email, en.channels.push]);
    expect(cards().querySelectorAll('li')).toHaveLength(CATEGORY_KEYS.length - 1);
    expect(within(cards()).getAllByRole('switch')).toHaveLength((CATEGORY_KEYS.length - 1) * 3);
    expect(matrix().textContent).not.toContain(en.categories.digestDaily.label);
  });

  it('locks the mandatory security alert channels with the explanation', () => {
    const actions = form();
    for (const channel of [en.channels.inApp, en.channels.email]) {
      const toggle = cell(matrix(), en.categories.securityAlert.label, channel);
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(toggle.hasAttribute('disabled')).toBe(true);
      const explanation = document.getElementById(toggle.getAttribute('aria-describedby') ?? '');
      expect(explanation?.textContent).toBe(en.mandatory);
      fireEvent.click(toggle);
    }
    expect(actions.setPreference).not.toHaveBeenCalled();
    expect(within(matrix()).getAllByRole('img', { name: en.lockedLabel })).toHaveLength(2);
    // Push for security alerts is the member's choice.
    const push = cell(matrix(), en.categories.securityAlert.label, en.channels.push);
    expect(push.hasAttribute('disabled')).toBe(false);
    // Only the mandatory category carries the explanation.
    expect(document.querySelectorAll('[data-slot="mandatory-explanation"]')).toHaveLength(2);
  });

  it('saves a channel switch for the category and says so', async () => {
    const actions = form();
    const toggle = cell(matrix(), en.categories.reminderHearing.label, en.channels.email);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    expect(actions.setPreference).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      category: 'reminder.hearing',
      channel: 'email',
      enabled: false,
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    // The card for the same category shows the same state.
    expect(
      cell(cards(), en.categories.reminderHearing.label, en.channels.email).getAttribute(
        'aria-checked',
      ),
    ).toBe('false');
    expect(screen.getByRole('status').textContent).toBe(en.saved);
  });

  it('rolls a failed save back and shows the error', async () => {
    const actions = fakeActions();
    actions.setPreference.mockImplementation(fail);
    form({ actions });
    const toggle = cell(cards(), en.categories.proposalNew.label, en.channels.inApp);
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(en.error);
    });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('chooses the digest from the segmented control', async () => {
    const actions = form();
    const group = screen.getByRole('radiogroup');
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual([en.digest.instant, en.digest.daily, en.digest.off]);
    expect(group.getAttribute('aria-labelledby')).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: 'Daily at 6:30 pm' }));
      await Promise.resolve();
    });
    expect(actions.setDigest).toHaveBeenCalledWith({ workspaceId: WORKSPACE.id, digest: 'daily' });
    expect(
      within(group).getByRole('radio', { name: en.digest.daily }).getAttribute('aria-checked'),
    ).toBe('true');

    actions.setDigest.mockImplementation(fail);
    await act(async () => {
      fireEvent.click(within(group).getByRole('radio', { name: en.digest.off }));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        within(group).getByRole('radio', { name: en.digest.daily }).getAttribute('aria-checked'),
      ).toBe('true');
    });
  });

  it('saves the court-hours and lock-screen toggles', async () => {
    const actions = form();
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Do not push during court hours' }));
      await Promise.resolve();
    });
    expect(actions.setCourtHoursQuiet).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      enabled: true,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'Show details on lock screen' }));
      await Promise.resolve();
    });
    expect(actions.setLockScreenDetails).toHaveBeenCalledWith({
      workspaceId: WORKSPACE.id,
      enabled: true,
    });
    expect(
      screen.getByRole('switch', { name: en.lockScreen.label }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('shows the empty state when no categories are returned (#288)', () => {
    form({ preferences: [] });
    const empty = document.querySelector('[data-slot="preferences-empty"]');
    expect(empty?.getAttribute('data-pattern-state')).toBe('empty');
    expect(empty?.textContent).toContain(en.empty);
    expect(matrix().className).toBe('hidden');
    expect(cards().className).toBe('hidden');
  });

  it('shows no empty state when there are categories', () => {
    form();
    expect(document.querySelector('[data-slot="preferences-empty"]')).toBeNull();
  });

  it('does not save anything on load', () => {
    const actions = form();
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('preferences copy', () => {
  function keys(node: unknown, prefix = ''): string[] {
    if (typeof node !== 'object' || node === null) return [prefix];
    return Object.entries(node).flatMap(([key, value]) =>
      keys(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  it('has the same preferences keys in en, ta and kn, and a label for every category', () => {
    const enKeys = keys(catalogs.en.notifications.preferences).sort();
    expect(keys(catalogs.ta.notifications.preferences).sort()).toEqual(enKeys);
    expect(keys(catalogs.kn.notifications.preferences).sort()).toEqual(enKeys);
    expect(Object.keys(en.categories)).toHaveLength(CATEGORY_KEYS.length);
  });

  it('carries the designed copy', () => {
    expect(en.digest).toMatchObject({ instant: 'Instant', daily: 'Daily at 6:30 pm', off: 'Off' });
    expect(en.courtHours.label).toBe('Do not push during court hours');
    expect(en.lockScreen.label).toBe('Show details on lock screen');
    expect(en.channels).toEqual({ inApp: 'In-app', email: 'Email', push: 'Push' });
  });

  it.each(['ta', 'kn'] as const)('renders only %s catalog strings', (locale) => {
    form({ locale });
    const text = document.body.textContent;
    const local = catalogs[locale].notifications.preferences;
    expect(text).toContain(local.categories.securityAlert.label);
    expect(text).toContain(local.mandatory);
    expect(text).toContain(local.digest.daily);
    for (const english of [
      en.categories.securityAlert.label,
      en.mandatory,
      en.digest.daily,
      en.courtHours.label,
      en.lockScreen.label,
    ]) {
      expect(text).not.toContain(english);
    }
  });
});
