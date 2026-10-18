import { DEFAULT_LOCALE, IST_TIME_ZONE, LOCALE_BCP47, type Locale } from '../locales';

import { toDate, type DateInput } from './date';

/** Clock time in IST, 12-hour in every locale (`10:30 am`). */
export function formatTime(input: DateInput, opts: { locale?: Locale } = {}): string {
  return new Intl.DateTimeFormat(LOCALE_BCP47[opts.locale ?? DEFAULT_LOCALE], {
    timeZone: IST_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(toDate(input));
}
