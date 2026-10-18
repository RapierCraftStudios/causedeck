import { DEFAULT_LOCALE, LOCALE_BCP47, type Locale } from '../locales';

export interface FormatListOptions {
  locale?: Locale;
  type?: 'conjunction' | 'disjunction';
}

/** `a, b and c` in the UI locale. Items are rendered as given, never translated. */
export function formatList(items: readonly string[], opts: FormatListOptions = {}): string {
  return new Intl.ListFormat(LOCALE_BCP47[opts.locale ?? DEFAULT_LOCALE], {
    type: opts.type ?? 'conjunction',
  }).format(items);
}
