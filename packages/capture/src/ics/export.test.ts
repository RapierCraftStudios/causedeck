// The private feed builder and the ICS writer (#53; PRD CA-5; docs/product/09 §3, §8): minimal
// content, stable UIDs, SEQUENCE bumps, CANCELLED for 30 days, nothing unconfirmed or sensitive, and
// no way to send anything (no attendee, organizer, method or alarm). Everything here is fictional.
import { describe, expect, it } from 'vitest';

import {
  buildFeed,
  CANCELLED_KEEP_DAYS,
  listingUid,
  obligationUid,
  type FeedListing,
  type FeedObligation,
  type FeedOptions,
  type FeedState,
} from './export.ts';
import { parseIcs } from './parse.ts';
import { escapeText, foldLine, vcalendar } from './serialize.ts';

const NOW = new Date('2027-10-01T06:00:00Z');
const OPTIONS: FeedOptions = {
  includeParties: false,
  workspaceUrl: 'https://app.example.test/w/demo',
  name: 'CauseDeck hearings',
};
const PARTIES = 'Fictional Traders v State of Nowhere';

const listing = (over: Partial<FeedListing> = {}): FeedListing => ({
  id: 'l1',
  matterId: 'm1',
  listDate: '2027-12-01',
  itemNo: '37',
  caseLabel: 'W.P. 12345/2026',
  hall: 'Court 12',
  forum: 'Madras High Court',
  confirmationState: 'confirmed',
  sensitive: false,
  parties: PARTIES,
  ...over,
});
const obligation = (over: Partial<FeedObligation> = {}): FeedObligation => ({
  id: 'o1',
  matterId: 'm1',
  dueDate: '2027-11-15',
  description: 'File the counter affidavit',
  caseLabel: 'W.P. 12345/2026',
  status: 'open',
  sensitive: false,
  parties: PARTIES,
  ...over,
});
const build = (
  listings: FeedListing[],
  obligations: FeedObligation[] = [],
  previous: FeedState[] = [],
  options: FeedOptions = OPTIONS,
  now: Date = NOW,
) => buildFeed(listings, obligations, previous, options, now);

describe('buildFeed: content', () => {
  const feed = build([listing()], [obligation()]);

  it('is a read-only calendar with a Kolkata VTIMEZONE and CRLF line ends', () => {
    expect(feed.body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(feed.body).toContain('BEGIN:VTIMEZONE\r\nTZID:Asia/Kolkata');
    expect(feed.body.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const forbidden of ['ATTENDEE', 'ORGANIZER', 'METHOD', 'VALARM', 'MAILTO', 'mailto:']) {
      expect(feed.body).not.toContain(forbidden);
    }
  });

  it('writes one event per confirmed listing and per open obligation with stable UIDs', () => {
    expect(feed.eventCount).toBe(2);
    expect(feed.body).toContain(`UID:${listingUid('l1')}`);
    expect(feed.body).toContain('UID:listing-l1@causedeck');
    expect(feed.body).toContain(`UID:${obligationUid('o1')}`);
  });

  it('keeps the summary minimal, with the hall and item and no party names', () => {
    const flat = feed.body.replace(/\r\n /g, '');
    expect(flat).toContain('SUMMARY:Hearing: W.P. 12345/2026 (Court 12\\, Item 37)');
    expect(flat).toContain('LOCATION:Madras High Court\\, Court 12');
    expect(flat).toContain('https://app.example.test/w/demo/matters/m1');
    expect(flat).not.toContain('Fictional Traders');
    expect(flat).not.toContain('counter affidavit');
    expect(flat).toContain('SUMMARY:Deadline: W.P. 12345/2026');
  });

  it('adds party names and the obligation text only when the feed asks for them', () => {
    const full = build([listing()], [obligation()], [], { ...OPTIONS, includeParties: true });
    const flat = full.body.replace(/\r\n /g, '');
    expect(flat).toContain('Fictional Traders v State of Nowhere');
    expect(flat).toContain('Deadline: W.P. 12345/2026 - File the counter affidavit');
  });

  it('never publishes unconfirmed dates, sensitive matters or closed obligations', () => {
    const hidden = build(
      [listing({ id: 'p', confirmationState: 'proposed' }), listing({ id: 's', sensitive: true })],
      [obligation({ id: 'c', status: 'closed' }), obligation({ id: 's2', sensitive: true })],
    );
    expect(hidden.eventCount).toBe(0);
    expect(hidden.body).not.toContain('listing-');
  });

  it('is a calendar a parser reads back as all-day events on the right days', () => {
    const parsed = parseIcs(feed.body, { now: NOW });
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.events.map((e) => [e.uid, e.date, e.allDay]).sort()).toEqual([
      ['listing-l1@causedeck', '2027-12-01', true],
      ['obligation-o1@causedeck', '2027-11-15', true],
    ]);
  });
});

describe('buildFeed: SEQUENCE, CANCELLED and ETag', () => {
  it('starts at SEQUENCE 0, keeps it while nothing changes and bumps it on a change', () => {
    const first = build([listing()]);
    expect(first.body).toContain('SEQUENCE:0');
    const same = build(
      [listing()],
      [],
      first.nextState,
      OPTIONS,
      new Date(NOW.getTime() + 3_600_000),
    );
    expect(same.body).toBe(first.body);
    expect(same.etag).toBe(first.etag);
    const moved = build(
      [listing({ listDate: '2027-12-08' })],
      [],
      same.nextState,
      OPTIONS,
      new Date(NOW.getTime() + 7_200_000),
    );
    expect(moved.body).toContain('SEQUENCE:1');
    expect(moved.etag).not.toBe(first.etag);
  });

  it('keeps a removed date as STATUS:CANCELLED for 30 days, then drops it', () => {
    const first = build([listing()]);
    const day = 24 * 3_600_000;
    const removed = build([], [], first.nextState, OPTIONS, new Date(NOW.getTime() + day));
    expect(removed.body).toContain('STATUS:CANCELLED');
    expect(removed.body).toContain('SEQUENCE:1');
    const kept = build([], [], removed.nextState, OPTIONS, new Date(NOW.getTime() + 20 * day));
    expect(kept.body).toContain('STATUS:CANCELLED');
    const gone = build(
      [],
      [],
      kept.nextState,
      OPTIONS,
      new Date(NOW.getTime() + (1 + CANCELLED_KEEP_DAYS) * day + 1000),
    );
    expect(gone.eventCount).toBe(0);
    expect(gone.nextState).toEqual([]);
  });

  it('un-cancels a date that comes back, with a higher SEQUENCE', () => {
    const first = build([listing()]);
    const removed = build([], [], first.nextState, OPTIONS, new Date(NOW.getTime() + 1000));
    const back = build([listing()], [], removed.nextState, OPTIONS, new Date(NOW.getTime() + 2000));
    expect(back.body).toContain('STATUS:CONFIRMED');
    expect(back.body).toContain('SEQUENCE:2');
  });

  // The wall-clock budget only holds on a quiet runner (#995); the work itself is always asserted.
  it('renders 500 events well inside 200 ms', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      listing({
        id: `l${String(i)}`,
        listDate: `2027-${String(1 + (i % 12)).padStart(2, '0')}-15`,
      }),
    );
    const started = performance.now();
    const feed = build(many);
    const elapsed = performance.now() - started;
    expect(feed.eventCount).toBe(500);
    // eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
    if (process.env.PERF_GATE === '1') expect(elapsed).toBeLessThan(200);
  });
});

describe('serialize', () => {
  it('escapes TEXT and folds long lines at 75 octets without splitting a character', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const line = `SUMMARY:${'தமிழ் '.repeat(30)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) {
      expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('has no write path: the document builder takes events and nothing else', () => {
    expect(vcalendar('x', [])).not.toMatch(/ATTENDEE|ORGANIZER|METHOD/);
  });
});
