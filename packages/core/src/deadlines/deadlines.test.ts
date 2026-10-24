import { describe, expect, it } from 'vitest';

import { computeDueDate, type CourtCalendar } from './index.ts';

const calendar = (over: Partial<CourtCalendar> = {}): CourtCalendar => ({
  forumCode: 'in.tn.madras-hc.chennai',
  weeklyOffs: [0],
  holidays: new Map(),
  vacations: [],
  ...over,
});

interface Row {
  phrase: string;
  from: string;
  n: number;
  unit: 'day' | 'week' | 'month';
  cal: CourtCalendar;
  due: string;
  rule: string;
}

// Real direction phrasings, counted from the order date on a forum calendar.
const TABLE: Row[] = [
  {
    phrase: 'file counter within four weeks',
    from: '2026-10-22',
    n: 4,
    unit: 'week',
    cal: calendar({ holidays: new Map([['2026-11-19', 'Holiday']]) }),
    due: '2026-11-20',
    rule: '4 weeks from 22 Oct; court closed 19 Nov, so 20 Nov',
  },
  {
    phrase: 'comply within 10 days',
    from: '2026-10-22',
    n: 10,
    unit: 'day',
    cal: calendar({ weeklyOffs: [] }),
    due: '2026-11-01',
    rule: '',
  },
  {
    phrase: 'comply within 10 days (ends on a Sunday)',
    from: '2026-10-22',
    n: 10,
    unit: 'day',
    cal: calendar({ weeklyOffs: [0] }),
    due: '2026-11-02',
    rule: '10 days from 22 Oct; court closed 1 Nov, so 2 Nov',
  },
  {
    phrase: 'file reply within two weeks (summer vacation)',
    from: '2027-05-10',
    n: 2,
    unit: 'week',
    cal: calendar({
      vacations: [{ from: '2027-05-24', to: '2027-06-06', name: 'Summer vacation' }],
    }),
    due: '2027-06-07',
    rule: '2 weeks from 10 May; court closed 24 May to 6 Jun, so 7 Jun',
  },
  {
    phrase: 'within one month of this order (month end clamp)',
    from: '2027-01-31',
    n: 1,
    unit: 'month',
    cal: calendar({ weeklyOffs: [] }),
    due: '2027-02-28',
    rule: '',
  },
  {
    phrase: 'holiday after a vacation',
    from: '2026-12-01',
    n: 3,
    unit: 'week',
    cal: calendar({
      holidays: new Map([['2026-12-25', 'Christmas']]),
      vacations: [{ from: '2026-12-22', to: '2026-12-24', name: 'Winter break' }],
    }),
    due: '2026-12-26',
    rule: '3 weeks from 1 Dec; court closed 22 Dec to 25 Dec, so 26 Dec',
  },
  {
    phrase: 'across a year boundary',
    from: '2026-12-20',
    n: 2,
    unit: 'week',
    cal: calendar({ holidays: new Map([['2027-01-03', 'Holiday']]) }),
    due: '2027-01-04',
    rule: '2 weeks from 20 Dec; court closed 3 Jan 2027, so 4 Jan 2027',
  },
];

describe('computeDueDate', () => {
  it.each(TABLE)('$phrase', (row) => {
    const out = computeDueDate({ from: row.from, n: row.n, unit: row.unit, calendar: row.cal });
    expect(out.date).toBe(row.due);
    if (row.rule !== '') expect(out.rule).toBe(row.rule);
  });

  it('states a plain period when the court sits on the last day', () => {
    const out = computeDueDate({ from: '2026-10-22', n: 1, unit: 'week', calendar: calendar() });
    expect(out).toEqual({ date: '2026-10-29', rawDate: '2026-10-29', rule: '1 week from 22 Oct' });
  });

  it('stops rolling when no day is open', () => {
    const out = computeDueDate({
      from: '2026-10-22',
      n: 1,
      unit: 'day',
      calendar: calendar({ weeklyOffs: [0, 1, 2, 3, 4, 5, 6] }),
    });
    expect(out.date > out.rawDate).toBe(true);
  });
});
