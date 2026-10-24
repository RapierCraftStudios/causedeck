// @vitest-environment jsdom
// Clerk-led onboarding (#505): the welcome page per role (in Tamil for a clerk), the one-tap
// approval controls, and that a clerk's permissions are unchanged (no strategy notes).
import { MATRIX, roleCan } from '@causedeck/auth/policy';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const state = vi.hoisted<{
  role: string;
  clerks: { memberId: string; userId: string; name: string; status: string | null }[];
  locale: 'en' | 'ta' | 'kn';
}>(() => ({
  role: 'clerk',
  clerks: [],
  locale: 'ta',
}));
vi.mock('next/navigation', () => ({ useRouter: () => router, notFound: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations(state.locale)(namespace),
}));
vi.mock('../components/locale-switcher.tsx', () => ({
  LocaleSwitcher: () => <div data-locale-switcher="list" />,
}));
vi.mock('../lib/workspace-loader.ts', () => ({
  getWorkspaceContext: () =>
    Promise.resolve({
      workspace: { id: 'w1', slug: 'hebbal', name: 'Hebbal' },
      role: state.role,
      user: { id: 'u1', name: 'Clerk', email: 'c@example.test' },
    }),
}));
vi.mock('@causedeck/core/runtime', () => ({
  inWorkspace: (_scope: unknown, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('@causedeck/core/workspaces', () => ({
  getClerkSetup: () => Promise.resolve(state.clerks),
}));
vi.mock('../app/(app)/w/[slug]/welcome/actions.ts', () => ({
  requestClerkSetupApprovalAction: vi.fn(),
  approveClerkSetupAction: vi.fn(),
}));

const { default: WelcomePage } = await import('../app/(app)/w/[slug]/welcome/page.tsx');
const { ApprovalButton } = await import('../app/(app)/w/[slug]/welcome/approval-buttons.tsx');

async function renderPage(locale: 'en' | 'ta' | 'kn') {
  state.locale = locale;
  const ui = await WelcomePage({
    params: Promise.resolve({ slug: 'hebbal' }),
    searchParams: Promise.resolve({}),
  });
  return renderIntl(ui, locale);
}

const renderIntl = (ui: ReactElement, locale: 'en' | 'ta' | 'kn' = 'en') =>
  render(
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  state.role = 'clerk';
  state.clerks = [];
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('welcome page', () => {
  it('shows a clerk the three steps and the ask button, in Tamil, with no strategy link', async () => {
    state.clerks = [{ memberId: 'm1', userId: 'u1', name: 'Clerk', status: null }];
    const { container } = await renderPage('ta');
    const ta = catalogs.ta.workspace.welcome;
    expect(container.querySelector('[data-clerk-welcome="clerk"]')).toBeTruthy();
    expect(screen.getByText(ta.steps.import.title)).toBeTruthy();
    expect(screen.getByText(ta.steps.today.title)).toBeTruthy();
    expect(screen.getByRole('button', { name: ta.approval.request })).toBeTruthy();
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/w/hebbal/import', '/w/hebbal/today']);
    expect(hrefs.some((h) => h?.includes('strategy'))).toBe(false);
  });

  it('has Kannada strings for the approval step', async () => {
    state.clerks = [{ memberId: 'm1', userId: 'u1', name: 'Clerk', status: 'approved' }];
    await renderPage('kn');
    expect(screen.getByText(catalogs.kn.workspace.welcome.approval.approved)).toBeTruthy();
  });

  it('lists waiting clerks for a member with workspace.manage, one approve tap each', async () => {
    state.role = 'owner';
    state.clerks = [
      { memberId: 'm1', userId: 'u2', name: 'Murugan', status: 'pending' },
      { memberId: 'm2', userId: 'u3', name: 'Suresh', status: 'approved' },
    ];
    await renderPage('en');
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.getByText(/Murugan/)).toBeTruthy();
    expect(screen.queryByText(/Suresh/)).toBeNull();
  });

  it('shows a junior only the notice', async () => {
    state.role = 'junior';
    await renderPage('en');
    expect(screen.getByText(catalogs.en.workspace.welcome.notForRole)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ApprovalButton', () => {
  const tap = async () =>
    act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await Promise.resolve();
    });

  it('calls the action once with its input and refreshes the page', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { memberId: 'm1', status: 'approved' as const } }),
    );
    renderIntl(
      <ApprovalButton
        kind="approve"
        action={action}
        input={{ workspaceId: 'w1', memberId: 'm1' }}
      />,
    );
    await tap();
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith({ workspaceId: 'w1', memberId: 'm1' });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('shows an alert and does not refresh when the action fails', async () => {
    const action = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: { code: 'FORBIDDEN' as const, message: 'no' } }),
    );
    renderIntl(<ApprovalButton kind="request" action={action} input={{ workspaceId: 'w1' }} />);
    await tap();
    expect(screen.getByRole('alert').textContent).toBe(
      catalogs.en.workspace.welcome.errors.generic,
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('clerk permissions are unchanged (#505)', () => {
  it('keeps strategy and memory at junior and gives a clerk no manage right', () => {
    expect(MATRIX['strategy.read']).toBe('junior');
    expect(roleCan('clerk', 'strategy.read')).toBe(false);
    expect(roleCan('clerk', 'workspace.manage')).toBe(false);
  });
});
