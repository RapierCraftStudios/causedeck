import { DEFAULT_LOCALE, LOCALE_BCP47, type Locale } from '../locales';

import { toDate, type DateInput } from './date';

/** `in 2 days` / `2 days ago`. Always numeric, so ta/kn never switch to words for "day after". */
export function formatRelative(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  opts: { locale?: Locale } = {},
): string {
  return new Intl.RelativeTimeFormat(LOCALE_BCP47[opts.locale ?? DEFAULT_LOCALE], {
    numeric: 'always',
  }).format(value, unit);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const IST_OFFSET = 5.5 * HOUR;

/** Whole IST calendar days since the epoch, so "tomorrow" turns over at IST midnight. */
const istDay = (ms: number) => Math.floor((ms + IST_OFFSET) / DAY);

/** Relative time of `input` from `now`, picking the unit: seconds up to a minute, then minutes,
 *  hours, IST calendar days, weeks (from 7 days) and months (from 30 days). */
export function formatRelativeFrom(
  input: DateInput,
  now: DateInput,
  opts: { locale?: Locale } = {},
): string {
  const from = toDate(now).getTime();
  const to = toDate(input).getTime();
  const diff = to - from;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return formatRelative(Math.trunc(diff / 1000), 'second', opts);
  if (abs < HOUR) return formatRelative(Math.trunc(diff / MINUTE), 'minute', opts);
  if (abs < DAY) return formatRelative(Math.trunc(diff / HOUR), 'hour', opts);
  const days = istDay(to) - istDay(from);
  if (Math.abs(days) < 7) return formatRelative(days, 'day', opts);
  if (Math.abs(days) < 30) return formatRelative(Math.trunc(days / 7), 'week', opts);
  return formatRelative(Math.trunc(days / 30), 'month', opts);
}
