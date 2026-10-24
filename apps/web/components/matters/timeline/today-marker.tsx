'use client';
// The Today marker (#41): an accent line with a label chip, the strongest element of the timeline
// together with the next canonical date. It sits between the last past event and the first future
// one (or after the last event when nothing is ahead), and is the target of "Jump to today" and
// the `t` key.
import { useTranslations } from 'next-intl';

export interface TodayMarkerProps {
  /** Today, formatted for the locale. */
  dateText: string;
}

export function TodayMarker({ dateText }: TodayMarkerProps) {
  const t = useTranslations('matterTimeline');
  return (
    <div data-today-marker="" className="relative flex items-center gap-2 py-2">
      <span aria-hidden="true" className="bg-accent h-0.5 flex-1" />
      <span className="bg-accent text-accent-ink rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums">
        {t('today.label', { date: dateText })}
      </span>
      <span aria-hidden="true" className="bg-accent h-0.5 flex-1" />
    </div>
  );
}
