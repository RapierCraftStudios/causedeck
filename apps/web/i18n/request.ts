import { getSessionCookie } from 'better-auth/cookies';
import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import {
  createMissingKeyHandlers,
  loadMessages as loadCatalog,
  type MissingKeyMode,
} from '@causedeck/i18n/server';

import { negotiateLocale } from '../lib/csp.ts';
import { isProd } from '../lib/env.ts';
import { logger } from '../src/health.ts';

import { isLocale, LOCALE_COOKIE, type Locale } from './routing.ts';

/**
 * The signed-in user's saved `user.locale` (#175). Without a session cookie there is no session to
 * look up, so public pages such as `/sign-in` never touch the database here. A failed lookup falls
 * through to the cookie rather than failing the render.
 */
async function userLocale(requestHeaders: Headers): Promise<Locale | undefined> {
  if (!getSessionCookie(requestHeaders)) return undefined;
  try {
    // Loaded lazily so this module stays free of the database until a session cookie is present.
    const { getSession } = await import('../lib/auth.ts');
    const locale = (await getSession())?.user.locale;
    return isLocale(locale) ? locale : undefined;
  } catch (error) {
    logger.warn({ err: error }, 'i18n: could not read the user locale');
    return undefined;
  }
}

/** Locale order: user setting > `NEXT_LOCALE` cookie > `Accept-Language` > `en`. */
export async function resolveLocale(): Promise<Locale> {
  const requestHeaders = await headers();
  const saved = await userLocale(requestHeaders);
  if (saved) return saved;
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  return negotiateLocale(undefined, requestHeaders.get('accept-language'));
}

/** Development shows missing keys; production renders English and reports to the logger. */
export function missingKeyMode(): MissingKeyMode {
  return isProd() ? 'production' : 'development';
}

/** The active locale's catalog (from `@causedeck/i18n`); ta/kn gaps are filled in production. */
export async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  return loadCatalog(locale, {
    mode: missingKeyMode(),
    report: ({ missingKeys }) => {
      logger.warn({ locale, missingKeys }, 'i18n: messages missing, rendering English');
    },
  });
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const messages = await loadMessages(locale);
  const handlers = createMissingKeyHandlers({
    mode: missingKeyMode(),
    fallback: locale === 'en' ? messages : await loadMessages('en'),
    report: (info) => {
      logger.warn({ locale, ...info }, 'i18n: message error');
    },
  });
  return { locale, messages, timeZone: 'Asia/Kolkata', ...handlers };
});
