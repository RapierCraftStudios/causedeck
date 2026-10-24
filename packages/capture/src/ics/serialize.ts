// RFC 5545 writer for the private feed (#53). CRLF line ends, 75-octet folding, TEXT escaping and a
// fixed Asia/Kolkata VTIMEZONE (+05:30, no daylight saving). The feed is read-only by construction:
// this writer has no ATTENDEE, ORGANIZER, METHOD or alarm property, so no calendar app sends or
// receives anything on the lawyer's behalf.
const CRLF = '\r\n';
const FOLD_OCTETS = 75;

/** Escape a TEXT value (backslash, semicolon, comma, newline). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold one content line at 75 octets, never inside a UTF-8 sequence. */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= FOLD_OCTETS) return line;
  const parts: string[] = [];
  let current = '';
  let limit = FOLD_OCTETS;
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > limit) {
      parts.push(current);
      current = char;
      limit = FOLD_OCTETS - 1;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

/** `YYYYMMDD` for a `YYYY-MM-DD` day. */
export const icsDate = (day: string): string => day.replace(/-/g, '');

/** `YYYYMMDDTHHMMSSZ` for an instant. */
export function icsUtc(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** The day after `day` (`YYYY-MM-DD`), for an all-day event's exclusive DTEND. */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export const VTIMEZONE_KOLKATA = [
  'BEGIN:VTIMEZONE',
  'TZID:Asia/Kolkata',
  'BEGIN:STANDARD',
  'DTSTART:19450101T000000',
  'TZOFFSETFROM:+0530',
  'TZOFFSETTO:+0530',
  'TZNAME:IST',
  'END:STANDARD',
  'END:VTIMEZONE',
];

export interface VEventFields {
  uid: string;
  dtstamp: Date;
  sequence: number;
  /** The IST day of the event, `YYYY-MM-DD` (all-day). */
  date: string;
  summary: string;
  location?: string | null;
  description?: string | null;
  cancelled?: boolean;
}

export function vevent(fields: VEventFields): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${fields.uid}`,
    `DTSTAMP:${icsUtc(fields.dtstamp)}`,
    `SEQUENCE:${String(fields.sequence)}`,
    `DTSTART;VALUE=DATE:${icsDate(fields.date)}`,
    `DTEND;VALUE=DATE:${icsDate(nextDay(fields.date))}`,
    `SUMMARY:${escapeText(fields.summary)}`,
  ];
  if (fields.location) lines.push(`LOCATION:${escapeText(fields.location)}`);
  if (fields.description) lines.push(`DESCRIPTION:${escapeText(fields.description)}`);
  lines.push('TRANSP:TRANSPARENT');
  lines.push(`STATUS:${fields.cancelled === true ? 'CANCELLED' : 'CONFIRMED'}`);
  lines.push('END:VEVENT');
  return lines;
}

/** A whole VCALENDAR document from already built VEVENT line groups. */
export function vcalendar(name: string, events: readonly (readonly string[])[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CauseDeck//Hearings feed//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-WR-TIMEZONE:Asia/Kolkata',
    ...VTIMEZONE_KOLKATA,
    ...events.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}
