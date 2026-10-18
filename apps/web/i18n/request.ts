import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

import { negotiateLocale } from '../lib/csp.ts';

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

export async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  const catalog = (await import(`../messages/${locale}.json`)) as {
    default: Record<string, unknown>;
  };
  return catalog.default;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: await loadMessages(locale), timeZone: 'Asia/Kolkata' };
});
