import { DEFAULT_LOCALE, LOCALE_BCP47, type Locale } from '../locales';

export interface FormatNumberOptions extends Intl.NumberFormatOptions {
  locale?: Locale;
}

export function formatNumber(value: number, opts: FormatNumberOptions = {}): string {
  const { locale = DEFAULT_LOCALE, ...options } = opts;
  return new Intl.NumberFormat(LOCALE_BCP47[locale], options).format(value);
}

/**
 * Groups a string of digits the Indian way: the last three, then pairs (`12,34,567`). Done by hand
 * because `Intl` uses Western grouping for `kn-IN`.
 */
export function formatIndianGrouping(digits: string): string {
  if (!/^\d+$/.test(digits)) throw new RangeError(`Not a digit string: ${digits}`);
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${head},${digits.slice(-3)}`;
}
