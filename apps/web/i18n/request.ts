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

/** The signed-in user's saved locale. Returns nothing until sessions exist (#12). */
function userLocale(): Promise<Locale | undefined> {
  return Promise.resolve(undefined);
}

/** Locale order: `NEXT_LOCALE` cookie > user setting > `Accept-Language` > `en`. */
export async function resolveLocale(): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return cookie;
  const saved = await userLocale();
  if (saved) return saved;
  return negotiateLocale(undefined, (await headers()).get('accept-language'));
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
