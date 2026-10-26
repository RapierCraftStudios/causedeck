// The court-day reminder builders (#64): the evening brief counts (and the push payload that never
// names a party), the morning diff, and the outcome-missing due time (90 minutes after the hall's
// last item, or 16:30 local) with the owner told for a delegated appearance. Pure: no database.
import type { CourtDay, ListDiff } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

import {
  addDays,
  buildEveningBrief,
  buildMorningDiff,
  eveningPushPayload,
  findMissingOutcomes,
  type HearingForOutcome,
} from './reminders.ts';

const M1 = 'member-1';
const FORUM = 'forum-1';

interface Spec {
  id: string;
  hall: string;
  title: string;
  members?: string[];
}

function dayOf(specs: Spec[]): CourtDay {
  const halls = [...new Set(specs.map((s) => s.hall))].map((hall) => ({
    hallId: hall,
    hallNo: hall,
    lists: [
      {
        items: specs
          .filter((s) => s.hall === hall)
          .map((s, i) => ({
            listingId: s.id,
            proceedingId: `p-${s.id}`,
            hallId: hall,
            itemNo: String(i + 1),
            matterTitle: s.title,
            appearingMemberIds: s.members ?? [M1],
          })),
      },
    ],
  }));
  return { date: '2026-10-26', complexes: [{ forumId: FORUM, halls }] } as unknown as CourtDay;
}

describe('buildEveningBrief', () => {
  it('counts listings, halls, clashes, low-readiness briefs and obligations', () => {
    const day = dayOf([
      { id: 'l1', hall: 'h1', title: 'Rao v State' },
      { id: 'l2', hall: 'h2', title: 'Iyer v Bank' },
      { id: 'l3', hall: 'h2', title: 'Nair v Nair', members: ['member-2'] },
    ]);
    const brief = buildEveningBrief({
      day,
      readiness: new Map([
        ['l1', 59],
        ['l2', 60],
      ]),
      obligationsDue: 2,
    });
    expect(brief).toMatchObject({
      listings: 3,
      halls: 2,
      clashes: 1,
      lowReadiness: 1,
      obligations: 2,
    });
    expect(brief?.names).toContain('Rao v State');
  });

  it('is null for a holiday or an empty day, so nothing is sent', () => {
    const empty = { date: '2026-10-26', complexes: [] } as unknown as CourtDay;
    expect(buildEveningBrief({ day: empty, readiness: new Map(), obligationsDue: 3 })).toBeNull();
  });

  it('keeps party names out of the push payload and links to /tomorrow', () => {
    const brief = buildEveningBrief({
      day: dayOf([{ id: 'l1', hall: 'h1', title: 'Rao v State' }]),
      readiness: new Map(),
      obligationsDue: 0,
    });
    if (brief === null) throw new Error('expected a brief');
    const payload = eveningPushPayload(brief);
    expect(payload.href).toBe('/tomorrow');
    expect(JSON.stringify(payload)).not.toContain('Rao');
    expect(payload).not.toHaveProperty('names');
  });
});

describe('buildMorningDiff', () => {
  const diff = (added: number, moved: number, removed: number, staged = 0): ListDiff =>
    ({
      added: Array.from({ length: added }),
      moved: Array.from({ length: moved }),
      stage_changed: Array.from({ length: staged }),
      removed: Array.from({ length: removed }),
    }) as unknown as ListDiff;

  it('is null when nothing changed', () => {
    expect(buildMorningDiff([])).toBeNull();
    expect(buildMorningDiff([diff(0, 0, 0)])).toBeNull();
  });

  it('sums added, moved (including stage changes) and removed over every list', () => {
    expect(buildMorningDiff([diff(1, 2, 0, 1), diff(2, 0, 3)])).toEqual({
      added: 3,
      moved: 3,
      removed: 3,
    });
  });
});

describe('findMissingOutcomes', () => {
  const dayStart = new Date('2026-10-25T18:30:00Z'); // 00:00 IST on 2026-10-26
  const at = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00+05:30`);
  const hearing = (over: Partial<HearingForOutcome> = {}): HearingForOutcome => ({
    hearingId: 'hr-1',
    listingId: 'l1',
    hallId: 'h1',
    outcome: null,
    appearances: [{ memberId: M1, capacity: 'self' }],
    matterOwnerMemberId: 'owner',
    ...over,
  });
  const run = (now: Date, over: Partial<HearingForOutcome> = {}, last?: Date) =>
    findMissingOutcomes({
      hearings: [hearing(over)],
      lastItemAt: new Map(last === undefined ? [] : [['h1', last]]),
      dayStart,
      now,
      delayMinutes: 90,
    });

  it('fires 90 minutes after the last item in the hall, not before', () => {
    expect(run(at('13:29'), {}, at('12:00'))).toEqual([]);
    expect(run(at('13:30'), {}, at('12:00'))).toMatchObject([
      { hearingId: 'hr-1', memberIds: [M1] },
    ]);
  });

  it('falls back to 16:30 when the hall has no marker', () => {
    expect(run(at('16:29'))).toEqual([]);
    expect(run(at('16:30'))).toHaveLength(1);
  });

  it('skips a confirmed outcome and an appearance with no member', () => {
    expect(run(at('18:00'), { outcome: 'adjourned' })).toEqual([]);
    expect(run(at('18:00'), { appearances: [{ memberId: null, capacity: 'self' }] })).toEqual([]);
  });

  it('tells the owner too for a delegated appearance only', () => {
    const delegated = run(at('18:00'), { appearances: [{ memberId: M1, capacity: 'proxy' }] });
    expect(delegated[0]?.memberIds).toEqual(['owner', M1].sort());
    expect(run(at('18:00'))[0]?.memberIds).toEqual([M1]);
  });
});

describe('addDays', () => {
  it('moves a date across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});
