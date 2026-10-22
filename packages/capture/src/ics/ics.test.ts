// ICS parsing, hearing-like detection, case-number matching and draft mapping (#53; PRD CA-5).
// Fixtures are synthetic files shaped like Google, Outlook and Apple exports and a hand-written
// diary, plus a malformed set; every name, case number and place in them is fictional.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ProposalDraftSchema } from '@causedeck/validators/proposal-draft';
import { describe, expect, it } from 'vitest';

import { classifyEvent } from './classify.ts';
import { caseCandidatesIn } from './match.ts';
import { parseIcs, RRULE_MAX_INSTANCES, type IcsEvent } from './parse.ts';
import { eventToDraft, type MatchedTarget } from './to-proposals.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(HERE, '../../fixtures/ics', name), 'utf8');
/** After Oct 2027 so the fixtures' December dates are in the future. */
const NOW = new Date('2027-10-01T00:00:00Z');
const parse = (text: string) => parseIcs(text, { now: NOW });
const byUid = (events: IcsEvent[], uid: string): IcsEvent => {
  const found = events.find((e) => e.uid === uid);
  if (found === undefined) throw new Error(`no event ${uid}`);
  return found;
};

describe('parseIcs: files from calendar apps', () => {
  it('reads a Google export: UTC, all-day, TZID=Asia/Kolkata and a cancelled event', () => {
    const { events, diagnostics } = parse(fixture('google.ics'));
    expect(diagnostics).toEqual([]);
    expect(events).toHaveLength(5);
    // 05:00 UTC is 10:30 in India.
    expect(byUid(events, 'g-hearing-1@google.com')).toMatchObject({
      date: '2027-12-01',
      time: '10:30',
      allDay: false,
      sequence: 0,
      status: 'confirmed',
      location: 'High Court, Court 12',
    });
    expect(byUid(events, 'g-allday-1@google.com')).toMatchObject({
      date: '2027-12-05',
      time: null,
      allDay: true,
      sequence: 1,
    });
    expect(byUid(events, 'g-doctor-1@google.com')).toMatchObject({
      date: '2027-11-10',
      time: '17:00',
    });
    expect(byUid(events, 'g-cancelled-1@google.com').status).toBe('cancelled');
    expect(byUid(events, 'g-hearing-1@google.com').dtstamp).toBe('2026-10-15T06:00:00.000Z');
    expect(byUid(events, 'g-hearing-1@google.com').raw).toContain('UID:g-hearing-1@google.com');
  });

  it('reads an Outlook export: a Windows zone name, SEQUENCE, RRULE with EXDATE', () => {
    const { events, diagnostics } = parse(fixture('outlook.ics'));
    expect(diagnostics).toEqual([]);
    const single = events.find((e) => e.uid.endsWith('outlook1'));
    expect(single).toMatchObject({ date: '2027-12-07', time: '10:30', sequence: 3 });
    const series = events.filter((e) => e.uid.endsWith('outlook2'));
    // Four Mondays from 29 Nov; the 6 Dec instance is excluded.
    expect(series.map((e) => e.date)).toEqual(['2027-11-29', '2027-12-13', '2027-12-20']);
    expect(series.every((e) => e.time === '15:00')).toBe(true);
    expect(series.map((e) => e.instanceKey)).toEqual(series.map((e) => `${e.uid}#${e.date}`));
  });

  it('reads an Apple export: another TZID is converted to India time, floating stays as written', () => {
    const { events } = parse(fixture('apple.ics'));
    // 08:30 in New York (UTC-5 in December) is 19:00 in India on the same day.
    expect(byUid(events, 'A1B2C3D4-APPLE-0001')).toMatchObject({
      date: '2027-12-02',
      time: '19:00',
    });
    expect(byUid(events, 'A1B2C3D4-APPLE-FLOATING')).toMatchObject({
      date: '2027-12-03',
      time: '09:30',
    });
  });

  it('moves an event across midnight with the zone, not the wall clock', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:late',
      'DTSTART:20271201T203000Z',
      'SUMMARY:Late',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    // 20:30 UTC is 02:00 the next day in India.
    expect(parse(text).events[0]).toMatchObject({ date: '2027-12-02', time: '02:00' });
  });

  it('expands an RRULE to 12 months and caps a series at 500 instances', () => {
    const diary = parse(fixture('diary-export.ics'));
    const daily = diary.events.filter((e) => e.uid === 'diary-2');
    // 15 Dec 2027 to 1 Jun 2028, inclusive.
    expect(daily).toHaveLength(170);
    expect(daily.every((e) => e.allDay)).toBe(true);

    const weekly = parse(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:forever',
        'DTSTART;TZID=Asia/Kolkata:20271001T100000',
        'RRULE:FREQ=WEEKLY',
        'SUMMARY:Forever',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    expect(weekly.events.length).toBeGreaterThan(50);
    expect(weekly.events.every((e) => e.date <= '2028-10-01')).toBe(true);

    const hourly = parse(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:busy',
        'DTSTART;TZID=Asia/Kolkata:20271001T100000',
        'RRULE:FREQ=HOURLY;COUNT=2000',
        'SUMMARY:Busy',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    expect(hourly.events).toHaveLength(RRULE_MAX_INSTANCES);
    expect(hourly.diagnostics.some((d) => d.message.includes('capped'))).toBe(true);
  });
});

describe('parseIcs: malformed files', () => {
  it.each(['not-ics.ics', 'truncated.ics'])(
    '%s returns an error diagnostic and no events',
    (name) => {
      const result = parse(fixture(`malformed/${name}`));
      expect(result.events).toEqual([]);
      expect(result.diagnostics[0]?.level).toBe('error');
    },
  );

  it('skips events without a UID or a readable start and says so', () => {
    const result = parse(fixture('malformed/bad-events.ics'));
    expect(result.events).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it('never throws, whatever the input', () => {
    for (const input of ['', '\u0000\u0001', 'BEGIN:VCALENDAR', 'x'.repeat(10_000)]) {
      expect(() => parse(input)).not.toThrow();
    }
  });
});

describe('classifyEvent', () => {
  const classify = (name: string, uid: string) =>
    classifyEvent(byUid(parse(fixture(name)).events, uid));

  it('scores events with a case number and hearing words as hearing-like', () => {
    expect(classify('google.ics', 'g-hearing-1@google.com')).toMatchObject({
      hearingLike: true,
      sensitive: false,
      score: 1,
    });
    expect(classify('google.ics', 'g-allday-1@google.com').hearingLike).toBe(true);
    expect(classify('apple.ics', 'A1B2C3D4-APPLE-0001').hearingLike).toBe(true);
    expect(classify('apple.ics', 'A1B2C3D4-APPLE-FLOATING').hearingLike).toBe(true);
  });

  it('reads a case number printed as "4521 of 2026" after other words', () => {
    const verdict = classifyEvent({
      summary: 'HC listing - WP 4521 of 2026',
      description: '',
      location: 'Court Hall 4',
      time: '10:30',
    });
    expect(verdict.hearingLike).toBe(true);
    expect(verdict.candidates).toEqual([{ caseType: 'WP', number: '4521', year: 2026 }]);
  });

  it('keeps a court location and a keyword without a case number as hearing-like (unmatched)', () => {
    expect(classify('diary-export.ics', 'diary-3').hearingLike).toBe(true);
  });

  it('ignores ordinary events', () => {
    expect(classify('google.ics', 'g-dinner-1@google.com').hearingLike).toBe(false);
    expect(classify('diary-export.ics', 'diary-2').hearingLike).toBe(false);
  });

  it('flags personal sensitive events so they are never stored', () => {
    const doctor = classify('google.ics', 'g-doctor-1@google.com');
    expect(doctor).toMatchObject({ sensitive: true, hearingLike: false });
  });

  it('does not mistake a party named Dr. for a medical event when a case number is present', () => {
    const verdict = classifyEvent({
      summary: 'Dr. Rao v State, W.P. 5/2026 hearing',
      description: '',
      location: '',
      time: '11:00',
    });
    expect(verdict).toMatchObject({ sensitive: false, hearingLike: true });
  });
});

describe('caseCandidatesIn', () => {
  it.each([
    ['W.P. 12345/2026 - hearing (Court 12, Item 37)', 'WP', '12345', 2026],
    ['CRL OP 77/2026 posted', 'CRLOP', '77', 2026],
    ['WP 12345/26 arguments', 'WP', '12345', 2026],
    ['Call re W.P. 9/2026 hearing', 'WP', '9', 2026],
    ['W.P.(MD) No. 120 of 2026', 'WP', '120', 2026],
  ])('%s', (text, caseType, number, year) => {
    expect(caseCandidatesIn(text)).toEqual([{ caseType, number, year }]);
  });

  it('finds nothing in text without a case number', () => {
    expect(caseCandidatesIn('Item 37 in Court 12 on 5/12')).toEqual([]);
    expect(caseCandidatesIn('Dinner')).toEqual([]);
  });
});

describe('eventToDraft', () => {
  const event = (over: Partial<IcsEvent> = {}): IcsEvent => ({
    uid: 'u1',
    instanceKey: 'u1',
    sequence: 0,
    dtstamp: null,
    status: 'confirmed',
    summary: 'W.P. 12345/2026 hearing, Item 37',
    description: '',
    location: '',
    allDay: false,
    date: '2027-12-01',
    time: '10:30',
    raw: 'BEGIN:VEVENT',
    ...over,
  });
  const target = (over: Partial<MatchedTarget> = {}): MatchedTarget => ({
    proceedingId: '00000000-0000-4000-8000-0000000000a1',
    matterId: '00000000-0000-4000-8000-0000000000b1',
    confirmedDate: null,
    confirmedListingId: null,
    ...over,
  });
  const ctx = {
    captureId: '00000000-0000-4000-8000-0000000000c1',
    today: '2027-10-01',
    anchorIds: ['00000000-0000-4000-8000-0000000000d1'],
    score: 0.9,
  };

  it('proposes a next date (never a confirmed one) as a deterministic calendar draft', () => {
    const outcome = eventToDraft(event(), target(), ctx);
    expect(outcome.kind).toBe('draft');
    if (outcome.kind !== 'draft') return;
    expect(outcome.draft).toMatchObject({
      kind: 'next_date',
      source: { type: 'deterministic', input: 'calendar', ref: 'u1' },
      payload: { date: '2027-12-01', itemNo: '37' },
      anchors: ctx.anchorIds,
    });
    expect(ProposalDraftSchema.safeParse(outcome.draft).success).toBe(true);
  });

  it('proposes the differing day too: the engine turns it into a conflict card, never an overwrite', () => {
    const outcome = eventToDraft(event(), target({ confirmedDate: '2027-11-20' }), ctx);
    expect(outcome).toMatchObject({ kind: 'draft', draft: { kind: 'next_date' } });
  });

  it('is a listing_update note when the day matches the confirmed date and names an item', () => {
    const outcome = eventToDraft(
      event(),
      target({
        confirmedDate: '2027-12-01',
        confirmedListingId: '00000000-0000-4000-8000-0000000000e1',
      }),
      ctx,
    );
    expect(outcome).toMatchObject({
      kind: 'draft',
      draft: { kind: 'listing_update', payload: { itemNo: '37' } },
    });
    if (outcome.kind === 'draft') {
      expect(ProposalDraftSchema.safeParse(outcome.draft).success).toBe(true);
    }
  });

  it('has nothing to say when the confirmed date already matches', () => {
    expect(
      eventToDraft(
        event({ summary: 'W.P. 12345/2026 hearing' }),
        target({ confirmedDate: '2027-12-01' }),
        ctx,
      ),
    ).toEqual({ kind: 'unchanged' });
  });

  it('ignores cancelled events and dates in the past', () => {
    expect(eventToDraft(event({ status: 'cancelled' }), target(), ctx)).toEqual({
      kind: 'ignored',
      reason: 'cancelled',
    });
    expect(eventToDraft(event({ date: '2027-09-01' }), target(), ctx)).toEqual({
      kind: 'ignored',
      reason: 'past',
    });
  });
});
