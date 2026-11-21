// Day labels for ISO dates (`yyyy-mm-dd`) shown to people, e.g. "Mon, 16 Nov". The date is a calendar
// day, not an instant, so it is formatted in UTC from midnight UTC and never shifts with the zone.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: string): Intl.DateTimeFormat {
  let format = formatters.get(locale);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    formatters.set(locale, format);
  }
  return format;
}

/** `2026-11-16` as "Mon, 16 Nov" in the given locale (en-IN by default). */
export function formatDay(date: string, locale = 'en-IN'): string {
  const instant = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(instant.getTime()) ? date : formatterFor(locale).format(instant);
}
