// One day of the feed (#49): a sticky heading ("Today", "Yesterday" or the date) over a list of
// activities. The day is the member's local day (IST).
import type { ActivityView } from '@causedeck/core/automation';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

export const FEED_TIME_ZONE = 'Asia/Kolkata';

/** The IST calendar day of an instant, `YYYY-MM-DD`. */
export function dayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FEED_TIME_ZONE }).format(new Date(iso));
}

/** Items in order, grouped by IST day (the input is newest first, so the groups are too). */
export function groupByDay(
  items: readonly ActivityView[],
): { day: string; items: ActivityView[] }[] {
  const groups: { day: string; items: ActivityView[] }[] = [];
  for (const item of items) {
    const day = dayOf(item.createdAt);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

export function ActivityDayGroup({
  day,
  today,
  yesterday,
  children,
}: {
  day: string;
  today: string;
  yesterday: string;
  children: ReactNode;
}) {
  const t = useTranslations('activity.feed');
  const format = useFormatter();
  const label =
    day === today
      ? t('today')
      : day === yesterday
        ? t('yesterday')
        : format.dateTime(new Date(`${day}T12:00:00+05:30`), {
            dateStyle: 'full',
            timeZone: FEED_TIME_ZONE,
          });
  return (
    <section data-slot="activity-day" data-day={day} aria-label={label}>
      <h2 className="bg-surface text-ink-muted sticky top-0 z-10 py-2 text-sm font-medium">
        {label}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}
