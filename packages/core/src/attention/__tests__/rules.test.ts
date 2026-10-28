// The pure stale-matter rules (#70): each rule, the clerk wording and the dormant-lifting helper.
import { describe, expect, it } from 'vitest';

import { isSilenced } from '../detect.ts';
import {
  evaluateRules,
  noNextDate,
  noRecentUpdate,
  obligationOverdueUnowned,
  pastDateNoOutcome,
  type MatterFacts,
} from '../rules.ts';

const ctx = { today: '2026-11-10', staleDays: 30 };
const facts = (over: Partial<MatterFacts> = {}): MatterFacts => ({
  matterId: 'm1',
  title: 'A v B',
  lastEventAt: new Date('2026-11-01T05:00:00Z'),
  openedAt: new Date('2026-01-01T00:00:00Z'),
  proceedings: [{ id: 'p1', state: 'pending' }],
  upcomingDates: [],
  listings: [],
  obligations: [],
  ...over,
});

describe('noNextDate', () => {
  it('flags a live proceeding with no upcoming date, naming the last event day', () => {
    const [hit] = noNextDate(facts());
    expect(hit?.evidence).toBe('No next date since 2026-11-01');
    expect(hit?.actionKind).toBe('set_next_date');
  });
  it('does not flag with an upcoming date or only disposed proceedings', () => {
    expect(noNextDate(facts({ upcomingDates: ['2026-11-20'] }))).toEqual([]);
    expect(noNextDate(facts({ proceedings: [{ id: 'p1', state: 'disposed' }] }))).toEqual([]);
  });
});

describe('pastDateNoOutcome', () => {
  const listing = {
    id: 'l1',
    proceedingId: 'p1',
    listDate: '2026-11-05',
    stageRaw: 'Arguments',
    hasOutcome: false,
  };
  it('flags a past listing without an outcome after the window, naming listing and date', () => {
    const [hit] = pastDateNoOutcome(facts({ listings: [listing] }), ctx);
    expect(hit?.evidence).toBe('Listing "Arguments" of 2026-11-05 has no recorded outcome');
    expect(hit?.redactedEvidence).toBe('Listing of 2026-11-05 has no recorded outcome');
    expect(hit?.actionKind).toBe('record_outcome');
  });
  it('waits out the hearing window and accepts a recorded outcome', () => {
    expect(
      pastDateNoOutcome(facts({ listings: [{ ...listing, listDate: '2026-11-09' }] }), ctx),
    ).toEqual([]);
    expect(pastDateNoOutcome(facts({ listings: [{ ...listing, hasOutcome: true }] }), ctx)).toEqual(
      [],
    );
  });
});

describe('noRecentUpdate', () => {
  it('flags beyond the threshold and honours a configured one', () => {
    const old = facts({ lastEventAt: new Date('2026-09-01T00:00:00Z') });
    expect(noRecentUpdate(old, ctx)).toHaveLength(1);
    expect(noRecentUpdate(old, { ...ctx, staleDays: 180 })).toEqual([]);
    expect(noRecentUpdate(facts(), ctx)).toEqual([]);
  });
});

describe('obligationOverdueUnowned', () => {
  it('flags an overdue unowned obligation only', () => {
    const f = facts({
      obligations: [
        { id: 'o1', dueDate: '2026-11-01', ownerMemberId: null },
        { id: 'o2', dueDate: '2026-11-01', ownerMemberId: 'x' },
        { id: 'o3', dueDate: '2026-11-20', ownerMemberId: null },
      ],
    });
    expect(obligationOverdueUnowned(f, ctx).map((h) => h.subjectId)).toEqual(['o1']);
  });
});

describe('evaluateRules', () => {
  it('only suggests text actions (no data change is part of a hit)', () => {
    for (const hit of evaluateRules(facts(), ctx)) {
      expect(typeof hit.suggestedAction).toBe('string');
    }
  });
});

describe('isSilenced', () => {
  const at = new Date('2026-11-05T00:00:00Z');
  it('holds a snooze through its end day', () => {
    const s = [{ rule: null, until: '2026-11-10', dismissed: false, createdAt: at }];
    expect(isSilenced(s, 'no_next_date', '2026-11-10', null)).toBe(true);
    expect(isSilenced(s, 'no_next_date', '2026-11-11', null)).toBe(false);
  });
  it('lifts a dismissal when the matter gets a newer event', () => {
    const s = [{ rule: 'no_next_date', until: null, dismissed: true, createdAt: at }];
    expect(isSilenced(s, 'no_next_date', '2026-11-10', new Date('2026-11-04T00:00:00Z'))).toBe(
      true,
    );
    expect(isSilenced(s, 'no_next_date', '2026-11-10', new Date('2026-11-06T00:00:00Z'))).toBe(
      false,
    );
    expect(isSilenced(s, 'no_recent_update', '2026-11-10', null)).toBe(false);
  });
});
