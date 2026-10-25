// UI locales. This module has no imports so apps and `@causedeck/db` can depend on it (via the
// `@causedeck/i18n/locales` subpath) without pulling in the formatters.
export const LOCALES = ['en', 'ta', 'kn'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Each locale's name in its own script, for the locale switcher. */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
  en: 'English',
  ta: 'தமிழ்',
  kn: 'ಕನ್ನಡ',
};

/** BCP-47 tags passed to `Intl`. */
export const LOCALE_BCP47: Readonly<Record<Locale, string>> = {
  en: 'en-IN',
  ta: 'ta-IN',
  kn: 'kn-IN',
};

/** Every date and time is rendered in IST. */
export const IST_TIME_ZONE = 'Asia/Kolkata';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
