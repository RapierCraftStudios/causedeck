'use client';

// The month view (#66): a density grid (`role="grid"`) of day cells with counts, clash and deadline
// markers. Roving tabindex: arrows move across days, Enter opens the day (its link), Home/End the row.
import type { CalendarDay } from '@causedeck/validators';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState, type KeyboardEvent } from 'react';

import { dayDeadlines } from './agenda-list.tsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function MonthView({
  days,
  month,
  hrefs,
}: {
  days: readonly CalendarDay[];
  /** `YYYY-MM`: days of other months are dimmed. */
  month: string;
  /** The day link per date (`YYYY-MM-DD`). A map, not a function: this is a client component. */
  hrefs: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('calendarView');
  const router = useRouter();
  const [active, setActive] = useState(0);
  const cells = useRef<(HTMLAnchorElement | null)[]>([]);
  const move = (to: number) => {
    const next = Math.max(0, Math.min(days.length - 1, to));
    setActive(next);
    cells.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      move(i + step);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(i - (i % 7));
    } else if (e.key === 'End') {
      e.preventDefault();
      move(i - (i % 7) + 6);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const day = days[i];
      const to = day === undefined ? undefined : hrefs[day.date];
      if (to !== undefined) router.push(to);
    }
  };
  const rows = Array.from({ length: Math.ceil(days.length / 7) }, (_, r) =>
    days.slice(r * 7, r * 7 + 7),
  );
  return (
    <div
      role="grid"
      aria-label={t('grid.month', { date: month })}
      data-view="month"
      className="flex flex-col gap-1"
    >
      <div role="row" className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} role="columnheader" className="text-ink-muted text-center text-xs">
            {t('grid.weekday', { day: w })}
          </div>
        ))}
      </div>
      {rows.map((row, r) => (
        <div key={r} role="row" className="grid grid-cols-7 gap-1">
          {row.map((d, c) => {
            const i = r * 7 + c;
            const deadlines = dayDeadlines(d);
            const summary = t('summary', { listings: d.counts.listings, deadlines });
            return (
              <div
                key={d.date}
                role="gridcell"
                data-date={d.date}
                data-clash={d.clash ? 'true' : undefined}
                className={`border-line min-h-16 rounded-md border p-1 text-xs ${
                  d.date.startsWith(month) ? '' : 'text-ink-muted'
                } ${d.closedReason === null ? '' : 'bg-surface-sunken'}`}
              >
                <a
                  ref={(el) => {
                    cells.current[i] = el;
                  }}
                  href={hrefs[d.date]}
                  tabIndex={i === active ? 0 : -1}
                  onFocus={() => {
                    setActive(i);
                  }}
                  onKeyDown={(e) => {
                    onKeyDown(e, i);
                  }}
                  className="flex flex-col gap-0.5"
                >
                  {/* The visible day number starts the accessible name (label in name); the counts
                      are read from the label, so their glyphs are hidden from assistive tech. */}
                  <span className="font-medium">{Number(d.date.slice(8))}</span>
                  <span className="sr-only">{`, ${t('dayLabel', { date: d.date, summary })}${
                    d.clash ? `, ${t('clash')}` : ''
                  }${d.closedReason === null ? '' : `, ${t('closed', { reason: d.closedReason })}`}`}</span>
                  {d.counts.listings > 0 ? (
                    <span aria-hidden="true">{`⚖ ${String(d.counts.listings)}`}</span>
                  ) : null}
                  {deadlines > 0 ? (
                    <span aria-hidden="true">{`⏰ ${String(deadlines)}`}</span>
                  ) : null}
                  {d.clash ? <span aria-hidden="true">⚠</span> : null}
                  {d.closedReason === null ? null : <span aria-hidden="true">⚑</span>}
                </a>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
