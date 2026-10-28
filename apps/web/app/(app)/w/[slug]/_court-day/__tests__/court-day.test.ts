// Pure helpers of the court-day board (#59): the IST day, item ordering keys, stage badge fallback,
// diff matching and roving-focus stepping.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import type { CourtDay, ListDiff } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

import { BOARD_SHORTCUTS, step } from '../keyboard.ts';
import { changeOf, ordinalOf, toStage } from '../item-card.tsx';
import { failuresOf, istDate, scopeDiffs } from '../load-court-day.ts';

describe('court-day board helpers', () => {
  it('istDate rolls the day at 18:30 UTC', () => {
    expect(istDate(new Date('2030-01-01T18:29:00Z'))).toBe('2030-01-01');
    expect(istDate(new Date('2030-01-01T18:31:00Z'))).toBe('2030-01-02');
    expect(istDate(new Date('2030-01-01T10:00:00Z'), 1)).toBe('2030-01-02');
  });

  it('ordinalOf reads the leading number of an item number', () => {
    expect(ordinalOf('12A')).toBe(12);
    expect(ordinalOf(null)).toBeNull();
    expect(ordinalOf('S')).toBeNull();
  });

  it('toStage falls back to listed for an unknown stage', () => {
    expect(toStage('numbered')).toBe('numbered');
    expect(toStage('part-heard')).toBe('part-heard');
    expect(toStage('something else')).toBe('listed');
    expect(toStage(null)).toBe('listed');
  });

  it('changeOf is null without a matching diff entry', () => {
    const item = { proceedingId: 'p1', caseLabel: 'WP 1/2030' } as Parameters<typeof changeOf>[0];
    expect(changeOf(item, [])).toBeNull();
  });

  it('step clamps and starts at the ends', () => {
    expect(step(0, -1, 1)).toBe(-1);
    expect(step(3, -1, 1)).toBe(0);
    expect(step(3, -1, -1)).toBe(2);
    expect(step(3, 2, 1)).toBe(2);
    expect(step(3, 0, -1)).toBe(0);
    expect(step(3, 1, 1)).toBe(2);
  });

  it('lists every shortcut once', () => {
    const keys = BOARD_SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['j', 'k', 'h', 'l', 'g then t', '?']));
  });
});

const FORUM = '00000000-0000-4000-8000-0000000000f1';
const item = (n: string, label: string) =>
  ({ itemNo: n, proceedingId: `p-${n}`, caseLabel: label, bench: [] }) as never;
const day = (date: string): CourtDay => ({
  date,
  scope: 'workspace',
  freshness: null,
  expectedNotListed: [],
  complexes: [
    {
      forumId: FORUM,
      name: 'Madras High Court',
      halls: [
        {
          hallId: null,
          hallNo: '3',
          marker: null,
          lists: [{ listType: 'daily', items: [item('1', 'WP 1/2026')] }],
        },
      ],
    },
  ],
});

describe('failuresOf', () => {
  const at = new Date('2026-03-11T18:00:00+05:30');
  const forum = (status: string, halls: string[]) => ({
    id: FORUM,
    latestParse: { status, at, hallsUnreadable: halls },
    officialList: { url: 'https://example.test/list' },
  });

  it('names each unreadable hall of a forum the day has items in, with the official link', () => {
    const [failure, ...rest] = failuresOf(day('2026-03-12'), [forum('degraded', ['12'])]);
    expect(rest).toEqual([]);
    expect(failure).toMatchObject({
      hallNo: '12',
      forum: 'Madras High Court',
      readAt: at,
      officialUrl: 'https://example.test/list',
    });
  });

  it('is empty for a clean run, another forum or a day the run was not for', () => {
    expect(failuresOf(day('2026-03-12'), [forum('ok', [])])).toEqual([]);
    expect(failuresOf(day('2026-03-12'), [{ ...forum('degraded', ['12']), id: 'other' }])).toEqual(
      [],
    );
    expect(failuresOf(day('2026-03-14'), [forum('degraded', ['12'])])).toEqual([]);
  });
});

describe('scopeDiffs', () => {
  const entry = (key: string) => ({
    kind: 'added' as const,
    proceedingKey: key,
    before: null,
    after: null,
  });
  const diff: ListDiff = {
    label: 'changed',
    added: [entry('WP 1/2026'), entry('WP 99/2026')],
    removed: [],
    moved: [],
    stage_changed: [],
    entries: [entry('WP 1/2026'), entry('WP 99/2026')],
  };

  it("keeps only the entries of the member's own items and drops an empty diff", () => {
    const [scoped] = scopeDiffs([diff], day('2026-03-12'));
    expect(scoped?.entries.map((e) => e.proceedingKey)).toEqual(['WP 1/2026']);
    expect(scoped?.added).toHaveLength(1);
    expect(
      scopeDiffs([{ ...diff, added: [], entries: [entry('WP 99/2026')] }], day('2026-03-12')),
    ).toEqual([]);
  });
});

// D-050: the board may show the bench a listing is before (cause-list content). It states no
// prediction and no judge analytics, ratings or per-judge aggregates, in its copy or its code.
describe('D-050 on the board', () => {
  const FORBIDDEN =
    /\b(predict\w*|likely|probab\w*|estimat\w*|expected to be (called|heard)|analytics|rating|rated|win rate|success rate|grant rate|average|statistic\w*)\b/i;
  const root = new URL('../../../../../../../..', import.meta.url).pathname;

  it('the board copy has no prediction or judge statistic', () => {
    const messages = JSON.parse(
      readFileSync(path.join(root, 'packages/i18n/src/messages/en/court-day.json'), 'utf8'),
    ) as { courtDay: { board: unknown } };
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === 'string') strings.push(value);
      else if (value !== null && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(messages.courtDay.board);
    expect(strings.filter((s) => FORBIDDEN.test(s))).toEqual([]);
  });

  it('the board sources import no estimate or analytics module', () => {
    const dir = path.join(root, 'apps/web/app/(app)/w/[slug]/_court-day');
    const sources = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => readFileSync(path.join(dir, f), 'utf8'));
    for (const source of sources) {
      expect(source).not.toMatch(/estimateCallWindow|getBenchCard|backtestEta|judge.?analytics/i);
    }
  });
});
