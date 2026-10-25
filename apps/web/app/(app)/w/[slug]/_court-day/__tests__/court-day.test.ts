// Pure helpers of the court-day board (#59): the IST day, item ordering keys, stage badge fallback,
// diff matching and roving-focus stepping.
import { describe, expect, it } from 'vitest';

import { BOARD_SHORTCUTS, step } from '../keyboard.ts';
import { changeOf, ordinalOf, toStage } from '../item-card.tsx';
import { istDate } from '../load-court-day.ts';

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
