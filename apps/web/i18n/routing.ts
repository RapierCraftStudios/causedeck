// Locales for apps/web. There is no locale URL prefix: the locale is a user preference carried in
// the `NEXT_LOCALE` cookie, so routes stay `/sign-in`, `/offline`, `/w/[slug]/...`.
export const locales = ['en', 'ta', 'kn'] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
