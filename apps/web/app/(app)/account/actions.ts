'use server';
// Change the UI language from the locale switcher (#175). Not workspace-scoped and open to signed-out
// callers (the sign-in footer), so it uses `safeAction` with the optional session. The `NEXT_LOCALE`
// cookie is always written; a signed-in user's `user.locale` is updated too, since the saved setting
// wins over the cookie in i18n/request.ts. Better Auth declares `locale` as `input: false`, so its
// public `updateUser` endpoint cannot change it; the internal adapter can.
import { LOCALES, type Locale } from '@causedeck/i18n/locales';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';

import { LOCALE_COOKIE } from '../../../i18n/routing.ts';
import { safeAction, type Result } from '../../../lib/safe-action.ts';

const ONE_YEAR = 60 * 60 * 24 * 365;

const SetLocaleInput = z.object({ locale: z.enum(LOCALES) });

export interface SetLocaleOutcome {
  locale: Locale;
  /** The "Language updated" toast, already in the new language. */
  message: string;
}

const setLocale = safeAction(SetLocaleInput, async ({ locale }, ctx): Promise<SetLocaleOutcome> => {
  if (ctx.session) {
    const { getAuth } = await import('../../../lib/auth.ts');
    const { internalAdapter } = await getAuth().$context;
    await internalAdapter.updateUser(ctx.session.user.id, { locale });
  }
  // Same attributes as the default proxy.ts sets.
  (await cookies()).set(LOCALE_COOKIE, locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
  const t = await getTranslations({ locale, namespace: 'locale' });
  return { locale, message: t('updated') };
});

export async function setLocaleAction(raw: unknown): Promise<Result<SetLocaleOutcome>> {
  return setLocale(raw);
}
