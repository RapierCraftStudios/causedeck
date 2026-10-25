'use client';

// The day popover (#66): the day's listings and deadlines in a dialog (a bottom sheet on a phone)
// that traps focus and closes on Escape. "Open day" goes to the Court-Day Board: `today` and
// `tomorrow` where the date is one of those, otherwise `calendar?day=`.
import type { CalendarDay } from '@causedeck/validators';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type KeyboardEvent } from 'react';

import { EntryLine, formatDay } from './agenda-list.tsx';

export function openDayHref(slug: string, date: string, today: string): string {
  const next = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (date === today) return `/w/${slug}/today`;
  if (date === next) return `/w/${slug}/tomorrow`;
  return `/w/${slug}/calendar?day=${date}`;
}

export function DayPopover({
  day,
  slug,
  today,
  closeHref,
}: {
  day: CalendarDay;
  slug: string;
  today: string;
  closeHref: string;
}) {
  const t = useTranslations('calendarView');
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('a,button')?.focus();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      router.push(closeHref);
      return;
    }
    if (e.key !== 'Tab' || ref.current === null) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>('a[href],button')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const listings = day.entries.filter((e) => e.kind === 'listing');
  const deadlines = day.entries.filter((e) => e.kind !== 'listing');
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={formatDay(day.date)}
      data-slot="day-popover"
      onKeyDown={onKeyDown}
      className="border-line bg-surface fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-t-lg border p-4 md:inset-x-auto md:end-6 md:bottom-6 md:w-96 md:rounded-lg"
    >
      <h2 className="font-serif text-lg font-medium">{formatDay(day.date)}</h2>
      {day.clash ? <p className="text-sm">{`⚠ ${t('day.clash')}`}</p> : null}
      {day.closedReason === null ? null : (
        <p className="text-ink-muted text-sm">{t('closed', { reason: day.closedReason })}</p>
      )}
      {day.entries.length === 0 ? <p className="text-sm">{t('day.nothing')}</p> : null}
      {listings.length > 0 ? (
        <section aria-label={t('day.listings')}>
          <h3 className="text-ink-muted text-xs font-medium">{t('day.listings')}</h3>
          <ul className="flex flex-col gap-1">
            {listings.map((e, i) => (
              <EntryLine key={i} entry={e} />
            ))}
          </ul>
        </section>
      ) : null}
      {deadlines.length > 0 ? (
        <section aria-label={t('day.deadlines')}>
          <h3 className="text-ink-muted text-xs font-medium">{t('day.deadlines')}</h3>
          <ul className="flex flex-col gap-1">
            {deadlines.map((e, i) => (
              <EntryLine key={i} entry={e} />
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex gap-2">
        <a
          href={openDayHref(slug, day.date, today)}
          data-open-day
          className="border-line rounded-md border px-3 py-1.5 text-sm"
        >
          {t('day.openDay')}
        </a>
        <a href={closeHref} className="text-ink-muted px-3 py-1.5 text-sm">
          {t('day.close')}
        </a>
      </div>
    </div>
  );
}
