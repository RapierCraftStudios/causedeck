// The automation feed's filters in the URL (#49): `?level=&kind=&matter=&matterName=&capture=&from=
// &to=&day=&q=`. Days are `YYYY-MM-DD` in IST with `to` inclusive; `day` is the digest's deep link
// (`/w/[slug]/activity?day=`) and is the same as `from` = `to` = that day. Plain functions shared
// by the server page and the client view, so they live outside the `'use client'` modules.
import { istDayAfter, istDayStart } from '../../app/(app)/w/[slug]/activity/filter-params.ts';

export const FEED_LEVELS = ['L1', 'L2', 'L3'] as const;
export type FeedLevel = (typeof FEED_LEVELS)[number];

export interface FeedFilters {
  level?: FeedLevel | undefined;
  /** A proposal kind (`task`, `document_attach`, ...). */
  kind?: string | undefined;
  /** Matter id; `matterName` is only the label shown on the chip. */
  matter?: string | undefined;
  matterName?: string | undefined;
  capture?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z][a-z0-9_]{0,59}$/;

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validDay(value: string | undefined): value is string {
  return value !== undefined && DAY.test(value) && !Number.isNaN(Date.parse(value));
}

/** Valid filters from the page's search params; anything malformed is dropped. */
export function parseFeedFilters(params: Params): FeedFilters {
  const filters: FeedFilters = {};
  const level = first(params.level);
  if ((FEED_LEVELS as readonly string[]).includes(level ?? '')) filters.level = level as FeedLevel;
  const kind = first(params.kind);
  if (kind !== undefined && KIND.test(kind)) filters.kind = kind;
  const matter = first(params.matter);
  if (matter !== undefined && UUID.test(matter)) {
    filters.matter = matter;
    const name = first(params.matterName)?.trim().slice(0, 200);
    if (name) filters.matterName = name;
  }
  const capture = first(params.capture);
  if (capture !== undefined && UUID.test(capture)) filters.capture = capture;
  const day = first(params.day);
  const from = validDay(day) ? day : first(params.from);
  const to = validDay(day) ? day : first(params.to);
  if (validDay(from)) filters.from = from;
  if (validDay(to) && !(filters.from !== undefined && filters.from > to)) filters.to = to;
  const q = first(params.q)?.trim().slice(0, 200);
  if (q) filters.q = q;
  return filters;
}

/** The query string for `filters` (no leading `?`). */
export function feedFilterQuery(filters: FeedFilters): string {
  const params = new URLSearchParams();
  for (const key of [
    'level',
    'kind',
    'matter',
    'matterName',
    'capture',
    'from',
    'to',
    'q',
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** True when any filter narrows the feed. */
export function hasFeedFilters(filters: FeedFilters): boolean {
  return feedFilterQuery(filters) !== '';
}

/** The filters as `listActivities` input (ISO instants, `to` exclusive). */
export function feedBounds(filters: FeedFilters): {
  level?: FeedLevel;
  kind?: string;
  matterId?: string;
  captureId?: string;
  from?: string;
  to?: string;
  q?: string;
} {
  return {
    ...(filters.level === undefined ? {} : { level: filters.level }),
    ...(filters.kind === undefined ? {} : { kind: filters.kind }),
    ...(filters.matter === undefined ? {} : { matterId: filters.matter }),
    ...(filters.capture === undefined ? {} : { captureId: filters.capture }),
    ...(filters.from === undefined ? {} : { from: istDayStart(filters.from) }),
    ...(filters.to === undefined ? {} : { to: istDayAfter(filters.to) }),
    ...(filters.q === undefined ? {} : { q: filters.q }),
  };
}
