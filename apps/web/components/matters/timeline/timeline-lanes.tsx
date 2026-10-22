'use client';
// Lanes mode (#41, >= 1280 px): up to four proceedings side by side on one shared time axis, a row
// per court day, so a lawyer can see how an appeal and its petition move against each other. Events
// with no proceeding (documents, matter-level obligations) sit in a `Matter` lane. More lanes than
// fit are chosen from a menu. The Today marker falls between the last past row and the first
// future one, as in Combined mode.
import { Popover, PopoverContent, PopoverTrigger } from '@causedeck/ui/popover';
import { Button } from '@causedeck/ui/button';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import type { GraphNodeView, TimelineEventView } from '../../../lib/matters/timeline.ts';
import { cn } from '../matter-card.tsx';

import { TimelineEventCard } from './timeline-event.tsx';
import { TodayMarker } from './today-marker.tsx';

export const MAX_LANES = 4;
const MATTER_LANE = '__matter';

export interface TimelineLanesProps {
  events: readonly TimelineEventView[];
  nodes: readonly Pick<GraphNodeView, 'id' | 'label'>[];
  todayText: string;
  offline?: boolean;
}

interface Lane {
  id: string;
  label: string;
}

/** The lanes with events, the matter lane first, then proceedings in tree order. */
export function lanesOf(
  events: readonly TimelineEventView[],
  nodes: readonly Pick<GraphNodeView, 'id' | 'label'>[],
  matterLabel: string,
): Lane[] {
  const used = new Set(events.map((e) => e.proceedingId ?? MATTER_LANE));
  const lanes: Lane[] = [];
  if (used.has(MATTER_LANE)) lanes.push({ id: MATTER_LANE, label: matterLabel });
  for (const node of nodes) if (used.has(node.id)) lanes.push({ id: node.id, label: node.label });
  return lanes;
}

export function TimelineLanes({ events, nodes, todayText, offline }: TimelineLanesProps) {
  const t = useTranslations('matterTimeline');
  const lanes = useMemo(() => lanesOf(events, nodes, t('lanes.matter')), [events, nodes, t]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const shown = useMemo(
    () =>
      (chosen ?? lanes.slice(0, MAX_LANES).map((l) => l.id)).filter((id) =>
        lanes.some((l) => l.id === id),
      ),
    [chosen, lanes],
  );
  const visible = lanes.filter((l) => shown.includes(l.id));
  const rows = useMemo(() => {
    const byDate = new Map<string, TimelineEventView[]>();
    for (const event of events) {
      if (!shown.includes(event.proceedingId ?? MATTER_LANE)) continue;
      byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
    }
    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [events, shown]);
  const firstFuture = rows.findIndex(([, list]) => list.some((e) => e.future));
  const columns = `6.5rem repeat(${String(Math.max(1, visible.length))}, minmax(0, 1fr))`;

  const toggle = (id: string) => {
    const next = shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id];
    setChosen(next.slice(0, MAX_LANES));
  };

  return (
    <div data-slot="timeline-lanes" className="flex flex-col gap-2">
      {lanes.length > MAX_LANES ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="self-start pointer-coarse:min-h-11">
              {t('lanes.menu', { count: lanes.length - MAX_LANES })}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="flex w-72 flex-col gap-1">
            <p className="text-ink-muted text-xs">{t('lanes.menuHint', { max: MAX_LANES })}</p>
            {lanes.map((lane) => {
              const on = shown.includes(lane.id);
              return (
                <label
                  key={lane.id}
                  className="flex min-h-8 items-center gap-2 text-sm tabular-nums pointer-coarse:min-h-11"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && shown.length >= MAX_LANES}
                    onChange={() => {
                      toggle(lane.id);
                    }}
                    className="size-4"
                  />
                  {lane.label}
                </label>
              );
            })}
          </PopoverContent>
        </Popover>
      ) : null}
      <div role="table" aria-label={t('lanes.label')} className="flex flex-col gap-2">
        <div
          role="row"
          className="bg-surface sticky top-0 z-10 grid gap-3 py-1"
          style={{ gridTemplateColumns: columns }}
        >
          <span role="columnheader" className="text-ink-muted text-xs font-medium">
            {t('lanes.date')}
          </span>
          {visible.map((lane) => (
            <span
              key={lane.id}
              role="columnheader"
              className="truncate text-sm font-medium tabular-nums"
            >
              {lane.label}
            </span>
          ))}
        </div>
        {rows.map(([date, list], index) => (
          <div key={date} className="flex flex-col gap-2">
            {index === firstFuture ? <TodayMarker dateText={todayText} /> : null}
            <div
              role="row"
              className={cn('grid gap-3', list.every((e) => e.future) && 'opacity-90')}
              style={{ gridTemplateColumns: columns }}
            >
              <span role="rowheader" className="text-ink-muted text-xs tabular-nums">
                {list[0]?.dateText}
              </span>
              {visible.map((lane) => (
                <div key={lane.id} role="cell" className="flex min-w-0 flex-col gap-2">
                  {list
                    .filter((e) => (e.proceedingId ?? MATTER_LANE) === lane.id)
                    .map((event) => (
                      <TimelineEventCard
                        key={event.id}
                        event={event}
                        hideProceeding
                        offline={offline}
                      />
                    ))}
                </div>
              ))}
            </div>
          </div>
        ))}
        {firstFuture === -1 && rows.length > 0 ? <TodayMarker dateText={todayText} /> : null}
      </div>
    </div>
  );
}
