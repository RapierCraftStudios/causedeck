// setLocaleAction (#175): the locale switcher's server action. Signed out it only writes the
// `NEXT_LOCALE` cookie; signed in it also saves `user.locale`, which outranks the cookie.
import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { catalogs, type TestLocale } from './helpers/intl.ts';

vi.mock('../src/health.ts', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const cookieSet = vi.hoisted(() => vi.fn());
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: cookieSet }),
}));

vi.mock('next-intl/server', () => ({
  getTranslations: ({ locale, namespace }: { locale: TestLocale; namespace: string }) =>
    Promise.resolve(
      createTranslator({ locale, messages: catalogs[locale], namespace: namespace as never }),
    ),
}));

const auth = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  updateUser: vi.fn(),
}));
vi.mock('../lib/auth.ts', () => ({
  getSession: () => Promise.resolve(auth.session),
  getAuth: () => ({
    $context: Promise.resolve({ internalAdapter: { updateUser: auth.updateUser } }),
  }),
}));

const { setLocaleAction } = await import('../app/(app)/account/actions.ts');

afterEach(() => {
  auth.session = null;
  auth.updateUser.mockReset();
  cookieSet.mockReset();
});

const COOKIE_OPTIONS = { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' };

describe('setLocaleAction (#175)', () => {
  it('rejects a locale outside en/ta/kn', async () => {
    const result = await setLocaleAction({ locale: 'hi' });
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('signed out: writes only the NEXT_LOCALE cookie', async () => {
    const result = await setLocaleAction({ locale: 'kn' });
    expect(result).toEqual({
      ok: true,
      data: { locale: 'kn', message: catalogs.kn.locale.updated },
    });
    expect(cookieSet).toHaveBeenCalledWith('NEXT_LOCALE', 'kn', COOKIE_OPTIONS);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('signed in: saves user.locale and the cookie, and answers in the new language', async () => {
    auth.session = { user: { id: 'user-1' } };
    const result = await setLocaleAction({ locale: 'ta' });
    expect(auth.updateUser).toHaveBeenCalledWith('user-1', { locale: 'ta' });
    expect(cookieSet).toHaveBeenCalledWith('NEXT_LOCALE', 'ta', COOKIE_OPTIONS);
    expect(result).toEqual({
      ok: true,
      data: { locale: 'ta', message: catalogs.ta.locale.updated },
    });
    expect(catalogs.ta.locale.updated).not.toBe(catalogs.en.locale.updated);
  });

  it('a failed save is INTERNAL and leaves the cookie alone', async () => {
    auth.session = { user: { id: 'user-1' } };
    auth.updateUser.mockRejectedValue(new Error('db down'));
    const result = await setLocaleAction({ locale: 'ta' });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
