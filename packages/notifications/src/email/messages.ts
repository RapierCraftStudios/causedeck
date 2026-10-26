// Email strings are i18n keys under `notifications.email` in packages/i18n (en, with ta/kn
// drafts). Catalogs load once per locale; a key missing from ta/kn falls back to English.
import { getPath, type Catalog } from '@causedeck/i18n/catalog';
import { DEFAULT_LOCALE, LOCALE_BCP47, isLocale, type Locale } from '@causedeck/i18n/locales';
import { loadMessages } from '@causedeck/i18n/server';
import format, { type CompiledMessage } from 'icu-minify/format';
import { IntlMessageFormat } from 'intl-messageformat';

export const EMAIL_KEY_PREFIX = 'notifications.email';

export type EmailLocale = Locale;

export type MessageValues = Record<string, string | number>;

/** Resolves `<area>.<key>` under `notifications.email` for one locale. */
export type Translate = (key: string, values?: MessageValues) => string;

const catalogs = new Map<Locale, Promise<Catalog>>();

function catalog(locale: Locale): Promise<Catalog> {
  let loaded = catalogs.get(locale);
  if (loaded === undefined) {
    loaded = loadMessages(locale, { mode: 'production' });
    catalogs.set(locale, loaded);
  }
  return loaded;
}

export function toEmailLocale(value: unknown): EmailLocale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The apps/web build precompiles the catalogs (next-intl `precompile`): a message with arguments
 * arrives as a compiled array, not an ICU string, while tests and plain Node get the ICU source.
 */
const formatters = {
  getDateTimeFormat: (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) =>
    new Intl.DateTimeFormat(...args),
  getNumberFormat: (...args: ConstructorParameters<typeof Intl.NumberFormat>) =>
    new Intl.NumberFormat(...args),
  getPluralRules: (...args: ConstructorParameters<typeof Intl.PluralRules>) =>
    new Intl.PluralRules(...args),
};

export function formatMessage(
  message: unknown,
  locale: Locale,
  values?: MessageValues,
): string | null {
  if (typeof message === 'string') {
    return String(new IntlMessageFormat(message, LOCALE_BCP47[locale]).format(values));
  }
  if (message === null || typeof message !== 'object') return null;
  return String(format(message as CompiledMessage, LOCALE_BCP47[locale], values, { formatters }));
}

export async function getTranslator(locale: EmailLocale): Promise<Translate> {
  const messages = await catalog(locale);
  return (key, values) => {
    const id = `${EMAIL_KEY_PREFIX}.${key}`;
    const message = getPath(messages, id);
    const text = formatMessage(message, locale, values);
    if (text === null) throw new Error(`Missing email message ${id}`);
    return text;
  };
}
