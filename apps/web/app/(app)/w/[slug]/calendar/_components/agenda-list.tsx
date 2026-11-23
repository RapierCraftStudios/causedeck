// The phone agenda (#66): a 7-day chip strip and the entries grouped by day. Also exports the one
// entry line that the week view and the day popover reuse.
import type { CalendarDay, CalendarEntry } from '@causedeck/validators';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { formatDay } from '../../../../../../lib/format-day.ts';

import { KindBadge } from './legend.tsx';

export const formatCalendarDay = (date: string, locale?: string) => formatDay(date, locale);

export function EntryLine({ entry }: { entry: CalendarEntry }) {
  const t = useTranslations('calendarView');
  const text = entry.redacted
    ? t('restricted')
    : [entry.matterTitle, entry.caseLabel, entry.label].filter((x) => x !== null).join(' · ');
  const place = [
    entry.hallNo === null ? null : t('day.hall', { hall: entry.hallNo }),
    entry.itemNo === null ? null : t('day.item', { item: entry.itemNo }),
  ].filter((x) => x !== null);
  return (
    <li
      data-entry={entry.kind}
      data-proposed={entry.proposed ? 'true' : undefined}
      className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-sm ${
        entry.proposed ? 'border-dashed' : 'border-line'
      }`}
    >
      <KindBadge kind={entry.kind} proposed={entry.proposed} />
      <span>{text}</span>
      {place.length > 0 ? <span className="text-ink-muted">{place.join(' · ')}</span> : null}
    </li>
  );
}

export function dayDeadlines(day: CalendarDay): number {
  return day.counts.nextDates + day.counts.obligationsDue;
}

export function AgendaList({
  days,
  hrefFor,
}: {
  days: readonly CalendarDay[];
  hrefFor: (date: string) => string;
}) {
  const t = useTranslations('calendarView');
  return (
    <div data-view="agenda" className="flex flex-col gap-3">
      <ul aria-hidden="true" className="flex max-w-full gap-1 overflow-x-auto pb-1">
        {days.map((d) => (
          <li key={d.date} className="shrink-0">
            <a
              href={`#agenda-${d.date}`}
              tabIndex={-1}
              className="border-line block rounded-full border px-3 py-1 text-xs whitespace-nowrap"
            >
              {formatCalendarDay(d.date)}
            </a>
          </li>
        ))}
      </ul>
      {days.map((d) => (
        <section
          key={d.date}
          id={`agenda-${d.date}`}
          aria-label={formatCalendarDay(d.date)}
          className="flex flex-col gap-1"
        >
          <h3 className="flex items-center justify-between text-sm font-medium">
            <Link href={hrefFor(d.date)}>{formatCalendarDay(d.date)}</Link>
            {d.clash ? <span>{`⚠ ${t('clash')}`}</span> : null}
          </h3>
          {d.closedReason === null ? null : (
            <p className="text-ink-muted text-xs">{t('closed', { reason: d.closedReason })}</p>
          )}
          <ul className="flex flex-col gap-1">
            {d.entries
              .filter((e) => e.kind !== 'holiday' && e.kind !== 'vacation')
              .map((e, i) => (
                <EntryLine key={i} entry={e} />
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
