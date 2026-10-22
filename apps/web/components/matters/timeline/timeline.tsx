'use client';
// The Timeline tab (#41, PRD PR-2, MG-1): the matter's proceedings graph beside its cross-proceeding
// timeline, both derived views (nothing is stored). Layout: 1280+ two panes (a sticky 340 px tree,
// the timeline filling the rest), 768 a row of proceeding chips with `Open tree` in a Sheet, 360 a
// `Timeline | Tree` switch with the filters in a bottom Sheet. Selecting proceedings in the tree
// filters the timeline; selection and filters are URL state (`use-timeline-state.ts`).
//
// The timeline: month headings (sticky), a Today marker, future events muted with a dotted
// connector, a labelled list (`aria-posinset`/`aria-setsize`) with a roving tab stop. Above 150
// events the rows are virtualised (`@tanstack/react-virtual`); focus and scroll survive a filter
// change. Keys: `[` and `]` previous and next month, `t` Today, `?` this list of keys (capture
// phase, so they win over the shell's `[` and `?`); inputs and modifier chords are left alone.
// Jumps scroll instantly, so "Jump to today" lands well inside 250 ms and reduced motion holds.
import { Button } from '@causedeck/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@causedeck/ui/dialog';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Kbd } from '@causedeck/ui/kbd';
import { OfflineBanner } from '@causedeck/ui/patterns';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@causedeck/ui/sheet';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CalendarClock, Filter, Keyboard, ListTree } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';

import type { TimelineEventView, TimelineView } from '../../../lib/matters/timeline.ts';
import { GraphView } from '../graph/graph-view.tsx';
import { useMatterAnnounce } from '../matter-announcer.tsx';
import { cn } from '../matter-card.tsx';
import { useOfflineSince } from '../matters-offline-banner.tsx';

import { ProceedingChips, TimelineFilters } from './timeline-filters.tsx';
import { TimelineEventCard } from './timeline-event.tsx';
import { TimelineLanes } from './timeline-lanes.tsx';
import { TodayMarker } from './today-marker.tsx';
import {
  filterEvents,
  isFiltered,
  useTimelineState,
  type TimelineMode,
} from './use-timeline-state.ts';

/** Timelines longer than this render only the rows in view. */
export const VIRTUALISE_ABOVE = 150;

export interface TimelineRow {
  event: TimelineEventView;
  /** 1-based position among the events shown. */
  pos: number;
  /** The month heading this row opens, when it is the first of its month. */
  heading: string | null;
  /** The Today marker sits above this row (first future event). */
  todayBefore: boolean;
  /** The Today marker sits below this row (last event, none ahead). */
  todayAfter: boolean;
}

/** The rows of the list: headings and the Today marker are attached to the events they border. */
export function buildRows(events: readonly TimelineEventView[]): TimelineRow[] {
  return events.map((event, index) => {
    const before = events[index - 1];
    const last = index === events.length - 1;
    return {
      event,
      pos: index + 1,
      heading: before?.monthKey === event.monthKey ? null : event.monthText,
      todayBefore: event.future && (before === undefined || !before.future),
      todayAfter: last && !event.future,
    };
  });
}

/** The row to land on for a month step from row `from`; null when there is none that way. */
export function monthTarget(
  rows: readonly TimelineRow[],
  from: number,
  direction: 1 | -1,
): number | null {
  const here = rows[from]?.event.monthKey;
  if (here === undefined) return null;
  if (direction === 1) {
    const next = rows.findIndex((row, i) => i > from && row.event.monthKey !== here);
    return next === -1 ? null : next;
  }
  // Previous: the start of this month if we are inside it, else the start of the month before.
  const start = rows.findIndex((row) => row.event.monthKey === here);
  if (start < from) return start;
  const before = rows[start - 1];
  if (before === undefined) return null;
  return rows.findIndex((row) => row.event.monthKey === before.event.monthKey);
}

/** The row Today points at: the first future event, else the last row. */
export function todayIndex(rows: readonly TimelineRow[]): number | null {
  const at = rows.findIndex((row) => row.todayBefore);
  if (at !== -1) return at;
  return rows.length === 0 ? null : rows.length - 1;
}

function useMediaMatch(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => {
        list.removeEventListener('change', notify);
      };
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function rowElement(root: HTMLElement | null, id: string): HTMLElement | undefined {
  return Array.from(root?.querySelectorAll<HTMLElement>('[data-row-id]') ?? []).find(
    (el) => el.dataset.rowId === id,
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

interface ListProps {
  rows: TimelineRow[];
  todayText: string;
  offline: boolean;
  listRef: RefObject<ListHandle | null>;
}

export interface ListHandle {
  jumpToToday: () => void;
  stepMonth: (direction: 1 | -1) => void;
}

function EventList({ rows, todayText, offline, listRef }: ListProps) {
  const t = useTranslations('matterTimeline');
  const virtual = rows.length > VIRTUALISE_ABOVE;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const hadFocus = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 132,
    overscan: 8,
  });

  const indexOfFocus = Math.max(
    0,
    rows.findIndex((row) => row.event.id === focusedId),
  );
  const stop = rows[indexOfFocus]?.event.id ?? rows[0]?.event.id;

  const focusRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (row === undefined) return;
      setFocusedId(row.event.id);
      if (virtual) virtualizer.scrollToIndex(index, { align: 'start' });
      const focus = () => {
        const el = rowElement(rootRef.current, row.event.id);
        el?.focus({ preventScroll: virtual });
        if (!virtual) el?.scrollIntoView({ block: 'start', behavior: 'auto' });
      };
      if (virtual) requestAnimationFrame(focus);
      else focus();
    },
    [rows, virtual, virtualizer],
  );

  useEffect(() => {
    listRef.current = {
      jumpToToday: () => {
        const at = todayIndex(rows);
        if (at !== null) focusRow(at);
      },
      stepMonth: (direction) => {
        const at = monthTarget(rows, indexOfFocus, direction);
        if (at !== null) focusRow(at);
      },
    };
  });

  // A filter change must not drop focus: put it back on the row it was on, or the nearest.
  useEffect(() => {
    if (!hadFocus.current || document.activeElement !== document.body) return;
    const target = rows.find((row) => row.event.id === focusedId) ?? rows[0];
    if (target === undefined) return;
    setFocusedId(target.event.id);
    rowElement(rootRef.current, target.event.id)?.focus({ preventScroll: true });
  }, [rows, focusedId]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    const go = (to: number) => {
      focusRow(Math.min(rows.length - 1, Math.max(0, to)));
    };
    if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(rows.length - 1);
    else return;
    event.preventDefault();
  }

  const renderRow = (
    row: TimelineRow,
    index: number,
    inline: boolean,
    place?: { style: CSSProperties; measure: (el: HTMLElement | null) => void },
  ) => (
    <li
      key={row.event.id}
      ref={place?.measure}
      style={place?.style}
      data-row-id={row.event.id}
      data-index={index}
      aria-posinset={row.pos}
      aria-setsize={rows.length}
      tabIndex={row.event.id === stop ? 0 : -1}
      onFocus={() => {
        hadFocus.current = true;
        setFocusedId(row.event.id);
      }}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget)) hadFocus.current = false;
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget) onKeyDown(e, index);
      }}
      className={cn(
        'focus-visible:outline-ring flex list-none flex-col gap-2 rounded-lg outline-offset-2 focus-visible:outline-2',
        place !== undefined && 'absolute inset-x-0 top-0 pb-3',
      )}
    >
      {inline && row.heading !== null ? (
        <h3 className="bg-surface text-ink-muted py-1 text-sm font-medium tabular-nums">
          {row.heading}
        </h3>
      ) : null}
      {row.todayBefore ? <TodayMarker dateText={todayText} /> : null}
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'ms-1 shrink-0 self-stretch border-s-2',
            row.event.future ? 'border-line-strong border-dotted' : 'border-line-strong',
          )}
        />
        <TimelineEventCard
          event={row.event}
          offline={offline}
          className={cn(
            'min-w-0 flex-1',
            index < 6 && 'motion-safe:animate-fade-in motion-safe:[animation-fill-mode:both]',
          )}
        />
      </div>
      {row.todayAfter ? <TodayMarker dateText={todayText} /> : null}
    </li>
  );

  if (virtual) {
    const items = virtualizer.getVirtualItems();
    const currentMonth = rows[items[0]?.index ?? 0]?.event.monthText ?? '';
    return (
      <div ref={rootRef}>
        <div
          ref={scrollRef}
          data-slot="timeline-scroller"
          className="relative max-h-[70dvh] overflow-auto"
        >
          <div
            aria-hidden="true"
            data-slot="sticky-month"
            className="bg-surface text-ink-muted sticky top-0 z-10 py-1 text-sm font-medium tabular-nums"
          >
            {currentMonth}
          </div>
          <ol
            aria-label={t('list.label')}
            className="relative m-0 p-0"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {items.map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              return renderRow(row, item.index, true, {
                style: { transform: `translateY(${String(item.start)}px)` },
                measure: virtualizer.measureElement,
              });
            })}
          </ol>
        </div>
      </div>
    );
  }

  // Few events: real month sections, each heading sticky inside its own section.
  const sections: { key: string; heading: string; rows: [TimelineRow, number][] }[] = [];
  rows.forEach((row, index) => {
    const last = sections[sections.length - 1];
    if (last === undefined || last.key !== row.event.monthKey) {
      sections.push({
        key: row.event.monthKey,
        heading: row.event.monthText,
        rows: [[row, index]],
      });
    } else last.rows.push([row, index]);
  });
  return (
    <div ref={rootRef} role="group" aria-label={t('list.label')} className="flex flex-col gap-3">
      {sections.map((section) => (
        <section key={section.key} aria-label={section.heading} className="flex flex-col gap-3">
          <h3
            aria-hidden="true"
            className="bg-surface text-ink-muted sticky top-0 z-10 py-1 text-sm font-medium tabular-nums"
          >
            {section.heading}
          </h3>
          <ol className="m-0 flex flex-col gap-3 p-0">
            {section.rows.map(([row, index]) => renderRow(row, index, false))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export interface TimelineWorkspaceProps {
  view: TimelineView;
  /** The page's query string, without `?`: the initial filters. */
  search: string;
  /** Today in IST, `YYYY-MM-DD`, and as the locale prints it. */
  todayText: string;
  /** Previews the offline state (stories, development). */
  forcedOffline?: boolean;
  /** The saved-at time the offline banner reports when offline is forced. */
  savedAt?: Date;
}

export function TimelineWorkspace({
  view,
  search,
  todayText,
  forcedOffline = false,
  savedAt,
}: TimelineWorkspaceProps) {
  const t = useTranslations('matterTimeline');
  const locale = useLocale();
  const announce = useMatterAnnounce();
  const state = useTimelineState(search);
  const { query, mode } = state;
  const offlineSince = useOfflineSince();
  const offlineAt = offlineSince ?? (forcedOffline ? (savedAt ?? new Date(0)) : null);
  const offline = offlineAt !== null;
  const wide = useMediaMatch('(min-width: 1280px)');
  const [pane, setPane] = useState<'timeline' | 'tree'>('timeline');
  const [treeOpen, setTreeOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const listRef = useRef<ListHandle | null>(null);

  const shown = useMemo(
    () => filterEvents(view.events, view.nodes, query),
    [view.events, view.nodes, query],
  );
  const rows = useMemo(() => buildRows(shown), [shown]);
  const filtered = isFiltered(query);
  const lanes = wide && mode === 'lanes';

  // Announce a changed result count (not the first render) in the polite live region.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    announce(t('announce.shown', { count: shown.length }));
  }, [shown.length, announce, t]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditable(event.target)) return;
      if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"]')) return;
      const handled =
        event.key === '[' || event.key === ']' || event.key === 't' || event.key === '?';
      if (!handled) return;
      event.preventDefault();
      if (event.key === '?') setKeysOpen(true);
      else if (event.key === 't') listRef.current?.jumpToToday();
      else listRef.current?.stepMonth(event.key === ']' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const graph = (
    <GraphView
      nodes={view.nodes}
      edges={view.edges}
      groups={view.groups}
      selected={query.p}
      onSelect={state.select}
      onClear={() => {
        state.set({ p: [] });
      }}
    />
  );

  const filters = (
    <TimelineFilters
      query={query}
      kinds={view.kinds}
      nodes={view.nodes}
      onChange={state.set}
      onClear={state.clear}
    />
  );

  const modes: TimelineMode[] = ['combined', 'lanes'];

  return (
    <div data-route="matter-timeline" className="flex flex-col gap-4">
      {offlineAt === null ? null : (
        <OfflineBanner
          data-timeline-offline=""
          savedAt={offlineAt}
          locale={`${locale}-IN`}
          labels={{ message: (time: string) => t('offline', { time }) }}
        />
      )}
      <div role="group" aria-label={t('pane.label')} className="flex gap-1 md:hidden">
        {(['timeline', 'tree'] as const).map((id) => (
          <Button
            key={id}
            variant={pane === id ? 'primary' : 'outline'}
            aria-pressed={pane === id}
            onClick={() => {
              setPane(id);
            }}
            className="min-h-11 flex-1"
          >
            {t(id === 'timeline' ? 'pane.timeline' : 'pane.tree')}
          </Button>
        ))}
      </div>
      {pane === 'tree' ? <div className="md:hidden">{graph}</div> : null}
      <div className="xl:grid xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start xl:gap-6">
        <aside className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] overflow-y-auto xl:block">
          {graph}
        </aside>
        <section
          aria-label={t('title')}
          className={cn('flex min-w-0 flex-col gap-3', pane === 'tree' && 'max-md:hidden')}
        >
          <div className="hidden md:block xl:hidden">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <ProceedingChips
                  nodes={view.nodes}
                  selected={query.p}
                  onSelect={state.select}
                  onClear={() => {
                    state.set({ p: [] });
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setTreeOpen(true);
                }}
                className="shrink-0 pointer-coarse:min-h-11"
              >
                <ListTree aria-hidden="true" />
                {t('pane.openTree')}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFiltersOpen(true);
              }}
              className="md:hidden pointer-coarse:min-h-11"
            >
              <Filter aria-hidden="true" />
              {t('filters.open')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              aria-keyshortcuts="t"
              onClick={() => {
                listRef.current?.jumpToToday();
              }}
              className="pointer-coarse:min-h-11"
            >
              <CalendarClock aria-hidden="true" />
              {t('today.jump')}
            </Button>
            <div
              role="group"
              aria-label={t('mode.label')}
              className="hidden items-center gap-1 xl:flex"
            >
              {modes.map((id) => (
                <Button
                  key={id}
                  variant={mode === id ? 'primary' : 'outline'}
                  size="sm"
                  aria-pressed={mode === id}
                  onClick={() => {
                    state.setMode(id);
                  }}
                >
                  {t(id === 'combined' ? 'mode.combined' : 'mode.lanes')}
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-keyshortcuts="?"
              onClick={() => {
                setKeysOpen(true);
              }}
              className="ms-auto pointer-coarse:min-h-11"
            >
              <Keyboard aria-hidden="true" />
              {t('keys.open')}
            </Button>
          </div>
          <div className="hidden md:block">{filters}</div>
          <p className="text-ink-muted text-sm tabular-nums" aria-hidden="true">
            {t('count', { shown: shown.length, total: view.events.length })}
          </p>
          {view.events.length === 0 ? (
            <EmptyState title={t('empty.title')} description={t('empty.body')} />
          ) : shown.length === 0 ? (
            <EmptyState
              title={t('filteredEmpty.title')}
              description={t('filteredEmpty.body')}
              action={<Button onClick={state.clear}>{t('filters.clear')}</Button>}
            />
          ) : lanes ? (
            <TimelineLanes
              events={shown}
              nodes={view.nodes}
              todayText={todayText}
              offline={offline}
            />
          ) : (
            <EventList rows={rows} todayText={todayText} offline={offline} listRef={listRef} />
          )}
          {filtered && shown.length > 0 ? (
            <Button variant="link" onClick={state.clear} className="self-start">
              {t('filters.clear')}
            </Button>
          ) : null}
        </section>
      </div>
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom">
          <SheetTitle>{t('filters.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('filters.description')}</SheetDescription>
          {filtersOpen ? filters : null}
        </SheetContent>
      </Sheet>
      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="end">
          <SheetTitle>{t('graph.title')}</SheetTitle>
          <SheetDescription className="sr-only">{t('graph.treeLabel')}</SheetDescription>
          {treeOpen ? graph : null}
        </SheetContent>
      </Sheet>
      <Dialog open={keysOpen} onOpenChange={setKeysOpen}>
        <DialogContent>
          <DialogTitle>{t('keys.title')}</DialogTitle>
          <DialogDescription>{t('keys.description')}</DialogDescription>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {(
              [
                ['[ / ]', 'keys.month'],
                ['t', 'keys.today'],
                ['↑ ↓', 'keys.rows'],
                ['Home / End', 'keys.ends'],
                ['?', 'keys.help'],
                ['↑ ↓ ← → Home End', 'keys.tree'],
                ['*', 'keys.expandAll'],
                ['Enter / Space', 'keys.select'],
                ['Shift + Enter', 'keys.selectMore'],
              ] as const
            ).map(([keys, label]) => (
              <div key={label} className="contents">
                <dt>
                  <Kbd>{keys}</Kbd>
                </dt>
                <dd>{t(label)}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
