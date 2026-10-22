'use client';
// The Timeline tab's view state (#41), mirrored in the URL so a view is shareable inside the
// workspace: `p` (proceeding ids, comma-separated), `k` (kinds), `from`, `to`, `proposed` (`0`
// hides proposed events), `mode` (`combined` or `lanes`) and `q` (text search). The URL is written
// with `history.replaceState`, so a filter change never re-runs the server page; the state is read
// from the URL on first render only. The Combined/Lanes choice is also remembered per viewer in
// localStorage; storage that throws (private mode, blocked) is ignored and the default stands.
// The parse, serialise and filter functions are pure and tested without React.
import { useCallback, useEffect, useState } from 'react';

// Types only: lib/matters/timeline.ts is server-only (logger, core).
import type { GraphNodeView, TimelineEventView } from '../../../lib/matters/timeline.ts';
import { TIMELINE_KINDS, type TimelineKind } from '../../../lib/matters/timeline-tab.ts';

export type TimelineMode = 'combined' | 'lanes';

export interface TimelineQuery {
  /** Selected proceedings; empty means all. */
  p: string[];
  /** Kinds shown; empty means all the member may see. */
  k: TimelineKind[];
  from: string;
  to: string;
  /** Show events that are proposed, not confirmed. */
  proposed: boolean;
  mode: TimelineMode | null;
  q: string;
}

export const EMPTY_QUERY: TimelineQuery = {
  p: [],
  k: [],
  from: '',
  to: '',
  proposed: true,
  mode: null,
  q: '',
};

export const MODE_STORAGE_KEY = 'causedeck.timeline.mode';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 200;

type Params = Pick<URLSearchParams, 'get'>;

/** The query a URL carries; unknown or malformed parts are dropped. */
export function parseTimelineQuery(params: Params): TimelineQuery {
  const list = (key: string) =>
    (params.get(key) ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
  const kinds = new Set<string>(TIMELINE_KINDS);
  const day = (key: string) => {
    const value = params.get(key) ?? '';
    return DAY.test(value) ? value : '';
  };
  const mode = params.get('mode');
  return {
    p: list('p').slice(0, 100),
    k: list('k').filter((kind): kind is TimelineKind => kinds.has(kind)),
    from: day('from'),
    to: day('to'),
    proposed: params.get('proposed') !== '0',
    mode: mode === 'combined' || mode === 'lanes' ? mode : null,
    q: (params.get('q') ?? '').slice(0, MAX_TEXT),
  };
}

/** The query string of `query` (without `?`), defaults left out. */
export function serializeTimelineQuery(query: TimelineQuery): string {
  const params = new URLSearchParams();
  if (query.p.length > 0) params.set('p', query.p.join(','));
  if (query.k.length > 0) params.set('k', query.k.join(','));
  if (query.from !== '') params.set('from', query.from);
  if (query.to !== '') params.set('to', query.to);
  if (!query.proposed) params.set('proposed', '0');
  if (query.mode !== null) params.set('mode', query.mode);
  if (query.q !== '') params.set('q', query.q);
  return params.toString();
}

/** True when any filter (not the mode) is set. */
export function isFiltered(query: TimelineQuery): boolean {
  return (
    query.p.length > 0 ||
    query.k.length > 0 ||
    query.from !== '' ||
    query.to !== '' ||
    !query.proposed ||
    query.q.trim() !== ''
  );
}

/** The selected proceedings and everything under them. */
export function selectedProceedings(
  nodes: readonly Pick<GraphNodeView, 'id' | 'parentId'>[],
  selected: readonly string[],
): Set<string> {
  const out = new Set(selected);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId !== null && out.has(node.parentId) && !out.has(node.id)) {
        out.add(node.id);
        grew = true;
      }
    }
  }
  return out;
}

/** The events `query` lets through, in their order. Events without a proceeding stay in. */
export function filterEvents(
  events: readonly TimelineEventView[],
  nodes: readonly Pick<GraphNodeView, 'id' | 'parentId'>[],
  query: TimelineQuery,
): TimelineEventView[] {
  const proceedings = query.p.length > 0 ? selectedProceedings(nodes, query.p) : null;
  const kinds = query.k.length > 0 ? new Set<string>(query.k) : null;
  const text = query.q.trim().toLowerCase();
  return events.filter((event) => {
    if (
      proceedings !== null &&
      event.proceedingId !== null &&
      !proceedings.has(event.proceedingId)
    ) {
      return false;
    }
    if (proceedings !== null && event.proceedingId === null) return false;
    if (kinds !== null && !kinds.has(event.kind)) return false;
    if (query.from !== '' && event.date < query.from) return false;
    if (query.to !== '' && event.date > query.to) return false;
    if (!query.proposed && event.proposed) return false;
    if (text !== '' && !event.searchText.includes(text)) return false;
    return true;
  });
}

function readStoredMode(): TimelineMode | null {
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY);
    return value === 'combined' || value === 'lanes' ? value : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: TimelineMode): void {
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable: the choice lasts for this page view only.
  }
}

export interface TimelineState {
  query: TimelineQuery;
  /** The mode in effect: the URL's, else the stored one, else combined. */
  mode: TimelineMode;
  set: (patch: Partial<TimelineQuery>) => void;
  /** Click selects one proceeding (or clears it when it is the only one); Shift adds or removes. */
  select: (id: string, additive: boolean) => void;
  /** One action: every filter back to its default (the mode stays). */
  clear: () => void;
  setMode: (mode: TimelineMode) => void;
}

/** The view state, initialised from `search` (the page's query string) and kept in the URL. */
export function useTimelineState(search: string): TimelineState {
  const [query, setQuery] = useState<TimelineQuery>(() =>
    parseTimelineQuery(new URLSearchParams(search)),
  );
  const [stored, setStored] = useState<TimelineMode | null>(null);

  useEffect(() => {
    setStored(readStoredMode());
  }, []);

  const apply = useCallback((next: TimelineQuery) => {
    setQuery(next);
    const text = serializeTimelineQuery(next);
    const url = `${window.location.pathname}${text === '' ? '' : `?${text}`}`;
    window.history.replaceState(window.history.state, '', url);
  }, []);

  const set = useCallback(
    (patch: Partial<TimelineQuery>) => {
      apply({ ...query, ...patch });
    },
    [apply, query],
  );

  const select = useCallback(
    (id: string, additive: boolean) => {
      const has = query.p.includes(id);
      let p: string[];
      if (additive) p = has ? query.p.filter((x) => x !== id) : [...query.p, id];
      else p = has && query.p.length === 1 ? [] : [id];
      apply({ ...query, p });
    },
    [apply, query],
  );

  const clear = useCallback(() => {
    apply({ ...EMPTY_QUERY, mode: query.mode });
  }, [apply, query.mode]);

  const setMode = useCallback(
    (mode: TimelineMode) => {
      writeStoredMode(mode);
      setStored(mode);
      apply({ ...query, mode });
    },
    [apply, query],
  );

  return { query, mode: query.mode ?? stored ?? 'combined', set, select, clear, setMode };
}
