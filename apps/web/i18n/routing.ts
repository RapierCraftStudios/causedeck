// Locales for apps/web. There is no locale URL prefix: the locale is a user preference carried in
// the `NEXT_LOCALE` cookie, so routes stay `/sign-in`, `/offline`, `/w/[slug]/...`. The list itself
// lives in `@causedeck/i18n/locales` (an import-free module, so the formatters stay out of bundles).
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@causedeck/i18n/locales';

export { isLocale, type Locale } from '@causedeck/i18n/locales';

export const locales = LOCALES;

export const defaultLocale: Locale = DEFAULT_LOCALE;

export const LOCALE_COOKIE = 'NEXT_LOCALE';
