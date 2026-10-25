// The week view (#66): days as rows, each grouped by hall; dates and deadlines under their own
// group. The phone shows the agenda list instead (`md:hidden` / `hidden md:block`).
import type { CalendarDay, CalendarEntry } from '@causedeck/validators';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { AgendaList, EntryLine, formatDay } from './agenda-list.tsx';

function groupByHall(entries: readonly CalendarEntry[]) {
  const groups = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    if (e.kind === 'holiday' || e.kind === 'vacation') continue;
    const key = e.kind === 'listing' ? (e.hallNo ?? '') : '\u0000other';
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()];
}

export function WeekView({
  days,
  hrefFor,
}: {
  days: readonly CalendarDay[];
  hrefFor: (date: string) => string;
}) {
  const t = useTranslations('calendarView');
  return (
    <>
      <div className="md:hidden">
        <AgendaList days={days} hrefFor={hrefFor} />
      </div>
      <div data-view="week" className="hidden flex-col gap-3 md:flex">
        {days.map((d) => (
          <section
            key={d.date}
            aria-label={formatDay(d.date)}
            className="border-line flex flex-col gap-2 rounded-md border p-3"
          >
            <h3 className="flex items-center justify-between text-sm font-medium">
              <Link href={hrefFor(d.date)}>{formatDay(d.date)}</Link>
              <span className="text-ink-muted text-xs">
                {d.closedReason === null ? '' : t('closed', { reason: d.closedReason })}
                {d.clash ? ` ⚠ ${t('clash')}` : ''}
              </span>
            </h3>
            {groupByHall(d.entries).map(([hall, entries]) => (
              <div key={hall} data-hall-group={hall === '\u0000other' ? 'other' : hall}>
                <h4 className="text-ink-muted text-xs">
                  {hall === '\u0000other'
                    ? t('week.other')
                    : hall === ''
                      ? t('week.noHall')
                      : t('week.hall', { hall })}
                </h4>
                <ul className="flex flex-col gap-1">
                  {entries.map((e, i) => (
                    <EntryLine key={i} entry={e} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
