// Server entry: loads one locale's catalog for next-intl's `getRequestConfig`. Only the active
// locale is imported per request, so only its messages reach `NextIntlClientProvider` (and the
// client). In production, ta/kn gaps are filled from English here and reported, so the client
// never needs the English catalog as a fallback.
import { deepMergeFallback, type Catalog } from './catalog';
import { DEFAULT_LOCALE, type Locale } from './locales';
import type { MissingKeyMode } from './missing';

export { createMissingKeyHandlers, type MissingKeyMode, type MissingKeyReport } from './missing';
export type { Messages } from './generated/messages';

/** Static imports per locale: bundlers split them and the next-intl plugin precompiles each. */
const CATALOGS: Record<Locale, () => Promise<{ default: unknown }>> = {
  en: () => import('./generated/messages/en.json'),
  ta: () => import('./generated/messages/ta.json'),
  kn: () => import('./generated/messages/kn.json'),
};

export interface LoadMessagesOptions {
  mode: MissingKeyMode;
  /** Called in production with the keys a locale lacks (they render in English). */
  report?: ((info: { locale: Locale; missingKeys: string[] }) => void) | undefined;
  /** Test seam: replaces the generated catalogs. */
  load?: ((locale: Locale) => Promise<Catalog>) | undefined;
}

async function importCatalog(locale: Locale): Promise<Catalog> {
  return (await CATALOGS[locale]()).default as Catalog;
}

export async function loadMessages(locale: Locale, options: LoadMessagesOptions): Promise<Catalog> {
  const load = options.load ?? importCatalog;
  const own = await load(locale);
  if (options.mode !== 'production' || locale === DEFAULT_LOCALE) return own;
  const { messages, missing } = deepMergeFallback(await load(DEFAULT_LOCALE), own);
  if (missing.length > 0) options.report?.({ locale, missingKeys: missing });
  return messages;
}
