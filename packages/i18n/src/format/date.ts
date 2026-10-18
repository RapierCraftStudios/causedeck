import { DEFAULT_LOCALE, IST_TIME_ZONE, LOCALE_BCP47, type Locale } from '../locales';

export type DateInput = Date | string | number;

export interface FormatDateOptions {
  locale?: Locale;
  /** `court` prefixes the weekday, as cause lists do: `Thu, 12 Mar 2026`. */
  style?: 'default' | 'court';
}

export function toDate(input: DateInput): Date {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(input)}`);
  return date;
}

/**
 * `dd MMM yyyy` in IST with the locale's month (and weekday) names. The order is fixed rather than
 * left to `Intl`, whose ta/kn patterns differ (`12 மார்., 2026`, `ಮಾರ್ಚ್ 12,2026`).
 */
export function formatDate(input: DateInput, opts: FormatDateOptions = {}): string {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const parts = new Intl.DateTimeFormat(LOCALE_BCP47[locale], {
    timeZone: IST_TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(toDate(input));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const date = `${part('day')} ${part('month')} ${part('year')}`;
  return opts.style === 'court' ? `${part('weekday')}, ${date}` : date;
}
