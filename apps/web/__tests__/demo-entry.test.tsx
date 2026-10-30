// @vitest-environment jsdom
// Demo entry (#93): `/demo` shows a card per sample workspace that exists; `POST /demo/enter` opens
// the demo session through Better Auth and redirects to the workspace with its cookies, or back to
// `/demo` with a reason; `POST /demo/leave` ends the session and goes to sign-in.
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogs, fakeGetTranslations } from './helpers/intl.ts';

const state = vi.hoisted(() => ({
  available: [] as { key: string }[],
  handler: vi.fn(),
}));

vi.mock('../lib/auth.ts', () => ({ getAuth: () => ({ handler: state.handler }) }));
vi.mock('../lib/env.ts', () => ({ serverEnv: () => ({ APP_URL: 'https://app.causedeck.test' }) }));
vi.mock('@causedeck/core/runtime', () => ({ db: {} }));
vi.mock('@causedeck/core/demo', () => ({
  listDemoWorkspaces: () => Promise.resolve(state.available),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: (namespace?: string) => fakeGetTranslations('en')(namespace),
}));

const { default: DemoPage } = await import('../app/(public)/demo/page.tsx');
const { POST: enter } = await import('../app/(public)/demo/enter/route.ts');
const { POST: leave } = await import('../app/(public)/demo/leave/route.ts');

async function renderPage(searchParams: Record<string, string> = {}) {
  const page = await DemoPage({ searchParams: Promise.resolve(searchParams) });
  return render(
    <NextIntlClientProvider locale="en" messages={catalogs.en}>
      {page}
    </NextIntlClientProvider>,
  );
}

const post = (
  url: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) => {
  // A string body with its content type: jsdom's URLSearchParams is not the fetch one.
  return new Request(`https://app.causedeck.test${url}`, {
    method: 'POST',
    body: new URLSearchParams(fields).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  });
};

function authResponse(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  state.available = [{ key: 'chennai-solo' }, { key: 'bengaluru-chamber' }];
  state.handler.mockReset();
});
afterEach(cleanup);

describe('/demo page', () => {
  it('shows the two sample workspaces as cards that post to /demo/enter', async () => {
    await renderPage();
    const copy = catalogs.en.shell.demoEntry;
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(copy.title);
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByRole('heading').textContent).toBe(
      copy.chennaiTitle,
    );
    expect(within(cards[1] as HTMLElement).getByRole('heading').textContent).toBe(
      copy.bengaluruTitle,
    );
    const forms = [...document.querySelectorAll('form')];
    expect(forms.map((f) => f.getAttribute('action'))).toEqual(['/demo/enter', '/demo/enter']);
    expect(forms.map((f) => f.querySelector<HTMLInputElement>('[name=workspace]')?.value)).toEqual([
      'chennai-solo',
      'bengaluru-chamber',
    ]);
    expect(screen.getAllByRole('button', { name: copy.enter })).toHaveLength(2);
    expect(screen.getByRole('link', { name: copy.back }).getAttribute('href')).toBe('/sign-in');
  });

  it('says the demo is unavailable when no sample workspace exists', async () => {
    state.available = [];
    await renderPage();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toContain(
      catalogs.en.shell.demoEntry.unavailable,
    );
  });

  it.each(['error', 'busy', 'unavailable'] as const)(
    'shows the %s reason with a retry',
    async (reason) => {
      await renderPage({ error: reason });
      expect(screen.getByRole('alert').textContent).toBe(catalogs.en.shell.demoEntry[reason]);
      expect(screen.getAllByRole('button')).toHaveLength(2);
    },
  );

  it('ignores an unknown reason', async () => {
    await renderPage({ error: 'constructor' });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('POST /demo/enter', () => {
  it('opens the session and redirects to the workspace with the session cookies', async () => {
    state.handler.mockResolvedValue(
      authResponse(200, { slug: 'demo-chennai-solo' }, [
        'better-auth.session_token=abc; Path=/; HttpOnly',
      ]),
    );
    const response = await enter(
      post('/demo/enter', { workspace: 'chennai-solo' }, { 'x-forwarded-for': '203.0.113.9' }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://app.causedeck.test/w/demo-chennai-solo');
    expect(response.headers.getSetCookie()).toEqual([
      'better-auth.session_token=abc; Path=/; HttpOnly',
    ]);
    const sent = state.handler.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe('https://app.causedeck.test/api/auth/demo/sign-in');
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('x-forwarded-for')).toBe('203.0.113.9');
    expect(await sent.json()).toEqual({ workspace: 'chennai-solo' });
  });

  it.each([
    [429, 'busy'],
    [404, 'unavailable'],
    [400, 'error'],
    [500, 'error'],
  ])('sends a %i back to /demo?error=%s without cookies', async (status, reason) => {
    state.handler.mockResolvedValue(authResponse(status, {}, ['x=1']));
    const response = await enter(post('/demo/enter', { workspace: 'chennai-solo' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `https://app.causedeck.test/demo?error=${reason}`,
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('refuses a post without a workspace and never calls auth', async () => {
    const response = await enter(post('/demo/enter', {}));
    expect(response.headers.get('location')).toBe('https://app.causedeck.test/demo?error=error');
    expect(state.handler).not.toHaveBeenCalled();
  });
});

describe('POST /demo/leave', () => {
  it('signs the visitor out, clears the cookies and goes to sign-in', async () => {
    state.handler.mockResolvedValue(
      authResponse(200, { success: true }, ['better-auth.session_token=; Max-Age=0; Path=/']),
    );
    const response = await leave(post('/demo/leave', { to: 'start' }, { cookie: 'a=b' }));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://app.causedeck.test/sign-in');
    expect(response.headers.getSetCookie()).toEqual([
      'better-auth.session_token=; Max-Age=0; Path=/',
    ]);
    const sent = state.handler.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe('https://app.causedeck.test/api/auth/sign-out');
    expect(sent.headers.get('cookie')).toBe('a=b');
  });
});
