// @vitest-environment jsdom
// `/invite/<token>` (#180): signed-out redirect through safe-next, one distinct state per preview,
// and the accept form's success, rejection, offline and error paths. Browser flows: e2e invite.spec.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AcceptInvitation } from '../app/(public)/invite/[token]/accept-form.tsx';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';

interface PageState {
  session: { user: { id: string; email: string } } | null;
  preview: Record<string, unknown>;
}
const state = vi.hoisted((): PageState => ({ session: null, preview: { state: 'INVALID' } }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const previewInvitation = vi.hoisted(() => vi.fn(() => Promise.resolve(state.preview)));

vi.mock('../lib/auth.ts', () => ({ getSession: () => Promise.resolve(state.session) }));
vi.mock('@causedeck/db', () => ({ db: {} }));
vi.mock('@causedeck/core/workspaces', () => ({ previewInvitation }));
vi.mock('../app/(public)/invite/[token]/actions.ts', () => ({ acceptInvitationAction: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

const { AcceptForm } = await import('../app/(public)/invite/[token]/accept-form.tsx');
const { default: InvitePage } = await import('../app/(public)/invite/[token]/page.tsx');

const en = catalogs.en.invite;
const TOKEN = 'tok_abc-123';
const USER = { id: 'u1', email: 'priya@example.test' };

const withIntl = (ui: ReactElement) =>
  render(
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="Asia/Kolkata">
      {ui}
    </NextIntlClientProvider>,
  );

async function renderPage() {
  withIntl(await InvitePage({ params: Promise.resolve({ token: TOKEN }) }));
}

let online = true;
beforeEach(() => {
  online = true;
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  state.session = { user: USER };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('invite page', () => {
  it('sends a signed-out visitor to sign-in with next back to the invite', async () => {
    state.session = null;
    await expect(InvitePage({ params: Promise.resolve({ token: TOKEN }) })).rejects.toThrow(
      `NEXT_REDIRECT /sign-in?next=${encodeURIComponent(`/invite/${TOKEN}`)}`,
    );
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it('shows a valid invitation with its workspace, role and Accept', async () => {
    state.preview = {
      state: 'VALID',
      workspaceName: 'Hebbal Chambers',
      workspaceSlug: 'hebbal',
      role: 'junior',
    };
    await renderPage();
    expect(previewInvitation).toHaveBeenCalledWith({}, { userId: USER.id, token: TOKEN });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Join Hebbal Chambers');
    expect(
      screen.getByText('You have been invited to join Hebbal Chambers as Junior.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: en.accept })).toBeTruthy();
    expect(document.querySelector('main')?.dataset.inviteState).toBe('valid');
  });

  it.each([
    ['EXPIRED', 'expired'],
    ['REVOKED', 'revoked'],
    ['USED', 'used'],
    ['INVALID', 'invalid'],
  ] as const)('shows a distinct %s state with no Accept', async (previewState, key) => {
    state.preview = { state: previewState, workspaceName: 'Hebbal Chambers', role: 'junior' };
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.states[key].title);
    expect(screen.getByText(en.states[key].body)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.accept })).toBeNull();
    expect(document.querySelector('main')?.dataset.inviteState).toBe(previewState.toLowerCase());
  });

  it('gives every dead-end state its own title', () => {
    const titles = Object.values(en.states).map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('rejects a different email clearly, naming only the signed-in address', async () => {
    state.preview = { state: 'EMAIL_MISMATCH', workspaceName: 'Hebbal Chambers', role: 'junior' };
    await renderPage();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      en.states.emailMismatch.title,
    );
    expect(screen.getByText(/You are signed in as priya@example\.test/)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.differentAccount })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.accept })).toBeNull();
  });

  it('links an existing member to the workspace', async () => {
    state.preview = {
      state: 'ALREADY_MEMBER',
      workspaceName: 'Hebbal Chambers',
      workspaceSlug: 'hebbal',
      role: 'clerk',
    };
    await renderPage();
    const link = screen.getByRole('link', { name: 'Open Hebbal Chambers' });
    expect(link.getAttribute('href')).toBe('/w/hebbal/today');
  });
});

describe('AcceptForm', () => {
  async function accept(action: AcceptInvitation) {
    withIntl(<AcceptForm token={TOKEN} action={action} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.accept }));
      await Promise.resolve();
    });
  }

  it('accepts and lands on the workspace Today', async () => {
    const action = vi.fn<AcceptInvitation>(() =>
      Promise.resolve({ ok: true, data: { status: 'accepted', slug: 'hebbal' } }),
    );
    await accept(action);
    expect(action).toHaveBeenCalledWith({ token: TOKEN });
    expect(router.push).toHaveBeenCalledWith('/w/hebbal/today');
  });

  it('shows the state of a token that went stale since the page rendered', async () => {
    const action = vi.fn<AcceptInvitation>(() =>
      Promise.resolve({ ok: true, data: { status: 'rejected', reason: 'REVOKED' } }),
    );
    await accept(action);
    expect(screen.getByRole('alert').textContent).toContain(en.states.revoked.title);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('says when the workspace has no seat left (#203)', async () => {
    const action = vi.fn<AcceptInvitation>(() =>
      Promise.resolve({ ok: true, data: { status: 'rejected', reason: 'SEAT_LIMIT' } }),
    );
    await accept(action);
    expect(screen.getByRole('alert').textContent).toContain(en.states.seatLimit.title);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not call the action offline', async () => {
    online = false;
    const action = vi.fn<AcceptInvitation>();
    await accept(action);
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(en.errors.offline);
  });

  it.each([
    ['UNAUTHENTICATED', en.errors.signedOut],
    ['INTERNAL', en.errors.generic],
  ] as const)('maps %s to calm copy', async (code, message) => {
    const action = vi.fn<AcceptInvitation>(() =>
      Promise.resolve({ ok: false, error: { code, message: 'raw' } }),
    );
    await accept(action);
    expect(screen.getByRole('alert').textContent).toBe(message);
  });
});
