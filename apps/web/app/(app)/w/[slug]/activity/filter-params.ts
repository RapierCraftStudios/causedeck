// Audit feed filters in the URL (#232): `?from=&to=&actor=&action=`, days as `YYYY-MM-DD` in IST
// with `to` inclusive. Plain functions shared by the server page and the client view, so they live
// outside the `'use client'` modules.

/** The filters as they stand in the URL. */
export interface AuditFilterValues {
  from?: string | undefined;
  to?: string | undefined;
  /** Actor user id. */
  actor?: string | undefined;
  /** Action group (`member`) or full action. */
  action?: string | undefined;
}

/** Action groups in the audit registry (`AUDIT_ACTIONS`, `@causedeck/core/audit`). */
export const ACTION_GROUPS = ['member', 'flag', 'usage', 'audit', 'workspace'] as const;

export const IST = 'Asia/Kolkata';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP = /^[a-z][a-z0-9_.]{0,99}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validDay(value: string | undefined): value is string {
  return value !== undefined && DAY.test(value) && !Number.isNaN(Date.parse(value));
}

/** Valid filters from the page's search params; anything malformed is dropped. */
export function parseAuditFilters(
  params: Record<string, string | string[] | undefined>,
): AuditFilterValues {
  const from = first(params.from);
  const to = first(params.to);
  const actor = first(params.actor);
  const action = first(params.action);
  const filters: AuditFilterValues = {};
  if (validDay(from)) filters.from = from;
  if (validDay(to) && !(filters.from && filters.from > to)) filters.to = to;
  if (actor && UUID.test(actor)) filters.actor = actor;
  if (action && GROUP.test(action)) filters.action = action;
  return filters;
}

/** The query string for `filters` (no leading `?`). */
export function auditFilterQuery(filters: AuditFilterValues): string {
  const params = new URLSearchParams();
  for (const key of ['from', 'to', 'actor', 'action'] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

/** A date as the IST day `YYYY-MM-DD`. */
export function istDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(date);
}

/** Start of the IST day `YYYY-MM-DD` as an ISO instant. */
export function istDayStart(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

/** Start of the IST day after `YYYY-MM-DD` (the exclusive upper bound of a range ending that day). */
export function istDayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00+05:30`) + DAY_MS).toISOString();
}

/** The filters as `queryAudit` bounds (ISO instants). */
export function filterBounds(filters: AuditFilterValues): {
  from?: string;
  to?: string;
  actorUserId?: string;
  actionGroup?: string;
} {
  return {
    ...(filters.from === undefined ? {} : { from: istDayStart(filters.from) }),
    ...(filters.to === undefined ? {} : { to: istDayAfter(filters.to) }),
    ...(filters.actor === undefined ? {} : { actorUserId: filters.actor }),
    ...(filters.action === undefined ? {} : { actionGroup: filters.action }),
  };
}
