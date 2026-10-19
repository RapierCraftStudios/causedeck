import { afterEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('../src/health.ts', () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));

interface RequestState {
  cookies: Record<string, string>;
  acceptLanguage: string | null;
}
const request = vi.hoisted((): RequestState => ({ cookies: {}, acceptLanguage: null }));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name in request.cookies ? { name, value: request.cookies[name] } : undefined,
    }),
  headers: () => {
    const h = new Headers();
    const cookie = Object.entries(request.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
    if (cookie) h.set('cookie', cookie);
    if (request.acceptLanguage !== null) h.set('accept-language', request.acceptLanguage);
    return Promise.resolve(h);
  },
}));

const getSession = vi.hoisted(() => vi.fn());
vi.mock('../lib/auth.ts', () => ({ getSession }));

const { loadMessages, missingKeyMode, resolveLocale } = await import('../i18n/request.ts');
const { catalogs } = await import('./helpers/intl.ts');

const SESSION = 'better-auth.session_token';

afterEach(() => {
  vi.unstubAllEnvs();
  warn.mockReset();
  getSession.mockReset();
  request.cookies = {};
  request.acceptLanguage = null;
});

describe('i18n/request resolveLocale (#175)', () => {
  it('prefers the signed-in user setting over the NEXT_LOCALE cookie and Accept-Language', async () => {
    request.cookies = { [SESSION]: 'token.sig', NEXT_LOCALE: 'kn' };
    request.acceptLanguage = 'en-IN';
    getSession.mockResolvedValue({ user: { id: 'u1', locale: 'ta' } });
    expect(await resolveLocale()).toBe('ta');
  });

  it('uses the NEXT_LOCALE cookie before Accept-Language when signed out', async () => {
    request.cookies = { NEXT_LOCALE: 'kn' };
    request.acceptLanguage = 'ta-IN,ta;q=0.9';
    expect(await resolveLocale()).toBe('kn');
    // No session cookie: no session lookup (and so no database query) for public pages.
    expect(getSession).not.toHaveBeenCalled();
  });

  it('falls back to Accept-Language, then en', async () => {
    request.acceptLanguage = 'ta-IN,ta;q=0.9,en;q=0.5';
    expect(await resolveLocale()).toBe('ta');
    request.acceptLanguage = 'fr-FR';
    expect(await resolveLocale()).toBe('en');
    request.acceptLanguage = null;
    expect(await resolveLocale()).toBe('en');
  });

  it('falls through to the cookie when the session is gone or cannot be read', async () => {
    request.cookies = { [SESSION]: 'stale.sig', NEXT_LOCALE: 'kn' };
    getSession.mockResolvedValue(null);
    expect(await resolveLocale()).toBe('kn');
    getSession.mockRejectedValue(new Error('db down'));
    expect(await resolveLocale()).toBe('kn');
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('i18n/request loadMessages (#174)', () => {
  it('loads the active locale from @causedeck/i18n', async () => {
    expect(await loadMessages('en')).toEqual(catalogs.en);
    expect(await loadMessages('kn')).toEqual(catalogs.kn);
  });

  it('shows keys in development and falls back to English in production', () => {
    expect(missingKeyMode()).toBe('development');
    vi.stubEnv('NODE_ENV', 'production');
    expect(missingKeyMode()).toBe('production');
  });

  it('in production returns a complete ta catalog without reporting gaps', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await loadMessages('ta')).toEqual(catalogs.ta);
    expect(warn).not.toHaveBeenCalled();
  });
});
