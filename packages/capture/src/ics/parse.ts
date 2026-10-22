// ICS parser (#53; PRD CA-5; docs/product/09 §3): `ical.js` reads the component tree and expands
// RRULEs; time zones are resolved here (Intl, fixed +05:30 for Asia/Kolkata) so a file without a
// VTIMEZONE still lands on the right Indian calendar day. Every event is normalised to an IST day
// and time. A malformed file or event yields a diagnostic, never an exception.
import ICAL from 'ical.js';

export const IST_ZONE = 'Asia/Kolkata';
export const IST_OFFSET_MIN = 330;
/** RRULE series are expanded this many months ahead of `now`. */
export const RRULE_HORIZON_MONTHS = 12;
/** At most this many instances of one series are kept. */
export const RRULE_MAX_INSTANCES = 500;
/** Hard stop on iterator steps, so a rule with no instance in range cannot spin. */
const ITERATION_LIMIT = 20_000;

export interface IcsEvent {
  uid: string;
  /** `UID` for a single event; `UID#<IST date>` for an RRULE instance. */
  instanceKey: string;
  sequence: number;
  dtstamp: string | null;
  status: 'confirmed' | 'tentative' | 'cancelled';
  summary: string;
  description: string;
  location: string;
  allDay: boolean;
  /** The IST calendar day, `YYYY-MM-DD`. */
  date: string;
  /** The IST wall-clock time `HH:MM`; null for an all-day event. */
  time: string | null;
  /** The VEVENT as serialised by the parser (the evidence kept in the anchor). */
  raw: string;
}

export interface IcsDiagnostic {
  level: 'warning' | 'error';
  message: string;
  uid?: string;
}

export interface IcsParseResult {
  events: IcsEvent[];
  diagnostics: IcsDiagnostic[];
}

export interface ParseOptions {
  now: Date;
}

/** Windows zone names (Outlook) that carry no IANA id. */
const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  'india standard time': IST_ZONE,
  utc: 'UTC',
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'pacific standard time': 'America/Los_Angeles',
  'gmt standard time': 'Europe/London',
  'w. europe standard time': 'Europe/Berlin',
  'singapore standard time': 'Asia/Singapore',
  'arabian standard time': 'Asia/Dubai',
};

interface Fields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const dayOf = (f: Fields): string => `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}`;
const asUtcMs = (f: Fields): number =>
  Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);

function fieldsFromMs(ms: number): Fields {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** The IANA id for a `TZID`, or null when it is not a known zone. */
export function resolveZone(tzid: string): string | null {
  const mapped = WINDOWS_ZONES[tzid.trim().toLowerCase()] ?? tzid.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: mapped });
    return mapped;
  } catch {
    return null;
  }
}

/** The zone's UTC offset in minutes at the instant `utcMs`. */
function offsetAt(zone: string, utcMs: number): number {
  if (zone === IST_ZONE) return IST_OFFSET_MIN;
  if (zone === 'UTC') return 0;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const local = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((local - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** The UTC instant of wall-clock `fields` in `zone` (the earlier instant across a DST fold). */
function wallToUtcMs(zone: string, fields: Fields): number {
  const guess = asUtcMs(fields);
  const first = guess - offsetAt(zone, guess) * 60_000;
  return guess - offsetAt(zone, first) * 60_000;
}

/** A start in the frame it was written in: UTC (`Z`), a named zone, or floating. */
interface Frame {
  zone: string | null;
}

function istFields(frame: Frame, local: Fields): Fields {
  if (frame.zone === null || frame.zone === IST_ZONE) return local;
  return fieldsFromMs(wallToUtcMs(frame.zone, local) + IST_OFFSET_MIN * 60_000);
}

function timeFields(time: ICAL.Time): Fields {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
    second: time.isDate ? 0 : time.second,
  };
}

function textOf(component: ICAL.Component, name: string): string {
  const value = component.getFirstPropertyValue(name);
  return typeof value === 'string' ? value : '';
}

function statusOf(component: ICAL.Component): IcsEvent['status'] {
  const raw = textOf(component, 'status').toUpperCase();
  if (raw === 'CANCELLED') return 'cancelled';
  return raw === 'TENTATIVE' ? 'tentative' : 'confirmed';
}

function frameOf(
  prop: ICAL.Property,
  time: ICAL.Time,
  diagnostics: IcsDiagnostic[],
  uid: string,
): Frame {
  if (time.isDate) return { zone: null };
  if (time.zone.tzid === 'UTC') return { zone: 'UTC' };
  const tzid = prop.getFirstParameter('tzid');
  if (typeof tzid !== 'string' || tzid === '') return { zone: null };
  const zone = resolveZone(tzid);
  if (zone === null) {
    diagnostics.push({ level: 'warning', message: `Unknown time zone ${tzid}; read as IST`, uid });
    return { zone: null };
  }
  return { zone };
}

/** EXDATE values as local `YYYY-MM-DDTHH:MM` / `YYYY-MM-DD` keys in the event's own frame. */
function excludedKeys(component: ICAL.Component): Set<string> {
  const keys = new Set<string>();
  for (const prop of component.getAllProperties('exdate')) {
    for (const value of prop.getValues()) {
      if (typeof value !== 'object' || value === null || !('year' in value)) continue;
      const time = value as ICAL.Time;
      const f = timeFields(time);
      keys.add(`${dayOf(f)}T${pad(f.hour)}:${pad(f.minute)}`);
      keys.add(dayOf(f));
    }
  }
  return keys;
}

function build(
  component: ICAL.Component,
  uid: string,
  instanceKey: string,
  ist: Fields,
  allDay: boolean,
): IcsEvent {
  const dtstamp = component.getFirstPropertyValue('dtstamp');
  const sequence = Number(component.getFirstPropertyValue('sequence'));
  return {
    uid,
    instanceKey,
    sequence: Number.isInteger(sequence) && sequence >= 0 ? sequence : 0,
    dtstamp:
      typeof dtstamp === 'object' && dtstamp !== null && 'toJSDate' in dtstamp
        ? dtstamp.toJSDate().toISOString()
        : null,
    status: statusOf(component),
    summary: textOf(component, 'summary'),
    description: textOf(component, 'description'),
    location: textOf(component, 'location'),
    allDay,
    date: dayOf(ist),
    time: allDay ? null : `${pad(ist.hour)}:${pad(ist.minute)}`,
    raw: component.toString(),
  };
}

function expand(
  component: ICAL.Component,
  start: ICAL.Time,
  frame: Frame,
  uid: string,
  now: Date,
  diagnostics: IcsDiagnostic[],
): IcsEvent[] {
  const rrule = component.getFirstPropertyValue('rrule');
  const out: IcsEvent[] = [];
  const horizonMs = (() => {
    const d = new Date(now.getTime());
    d.setUTCMonth(d.getUTCMonth() + RRULE_HORIZON_MONTHS);
    return d.getTime();
  })();
  const floorMs = now.getTime() - 24 * 60 * 60 * 1000;
  const excluded = excludedKeys(component);
  const iterator = (rrule as ICAL.Recur).iterator(start);
  let steps = 0;
  for (;;) {
    // `next()` returns null once the rule has no more instances.
    const next = iterator.next() as ICAL.Time | null;
    if (next === null) break;
    steps += 1;
    if (steps > ITERATION_LIMIT) {
      diagnostics.push({ level: 'warning', message: 'Recurrence expansion stopped early', uid });
      break;
    }
    const local = timeFields(next);
    const ist = istFields(frame, local);
    const ms = asUtcMs(ist) - IST_OFFSET_MIN * 60_000;
    if (ms > horizonMs) break;
    if (ms < floorMs) continue;
    if (excluded.has(`${dayOf(local)}T${pad(local.hour)}:${pad(local.minute)}`)) continue;
    if (excluded.has(dayOf(local)) && start.isDate) continue;
    if (out.length >= RRULE_MAX_INSTANCES) {
      diagnostics.push({
        level: 'warning',
        message: `Series capped at ${String(RRULE_MAX_INSTANCES)} instances`,
        uid,
      });
      break;
    }
    out.push(build(component, uid, `${uid}#${dayOf(ist)}`, ist, start.isDate));
  }
  return out;
}

/** Parse an `.ics` file. Never throws: problems are returned as diagnostics. */
export function parseIcs(text: string, { now }: ParseOptions): IcsParseResult {
  const diagnostics: IcsDiagnostic[] = [];
  const events: IcsEvent[] = [];
  let root: ICAL.Component;
  try {
    const parsed: unknown = ICAL.parse(text.replace(/^\uFEFF/, ''));
    // One component parses to its jCal array; several parse to a list of them.
    const first: unknown =
      Array.isArray(parsed) && typeof parsed[0] !== 'string' ? parsed[0] : parsed;
    root = new ICAL.Component(first as unknown[]);
  } catch (error) {
    diagnostics.push({
      level: 'error',
      message: `Not a readable calendar file: ${error instanceof Error ? error.message : 'unknown'}`,
    });
    return { events, diagnostics };
  }
  if (root.name !== 'vcalendar') {
    diagnostics.push({ level: 'error', message: 'No VCALENDAR found' });
    return { events, diagnostics };
  }
  for (const component of root.getAllSubcomponents('vevent')) {
    const rawUid = component.getFirstPropertyValue('uid');
    const uid = typeof rawUid === 'string' ? rawUid.trim() : '';
    try {
      const prop = component.getFirstProperty('dtstart');
      const start = prop?.getFirstValue();
      if (uid === '' || !prop || typeof start !== 'object' || start === null) {
        diagnostics.push({ level: 'warning', message: 'Event skipped: no UID or DTSTART' });
        continue;
      }
      const time = start as ICAL.Time;
      const frame = frameOf(prop, time, diagnostics, uid);
      if (component.hasProperty('rrule')) {
        events.push(...expand(component, time, frame, uid, now, diagnostics));
        continue;
      }
      events.push(build(component, uid, uid, istFields(frame, timeFields(time)), time.isDate));
    } catch (error) {
      diagnostics.push({
        level: 'warning',
        message: `Event skipped: ${error instanceof Error ? error.message : 'unreadable'}`,
        ...(uid === '' ? {} : { uid }),
      });
    }
  }
  return { events, diagnostics };
}
