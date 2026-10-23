import { describe, expect, it } from 'vitest';

import { addInterval, findRelativePhrases, RELATIVE_RULE, resolveRelative } from './relative.ts';

describe('resolveRelative', () => {
  it.each([
    ['list after four weeks', '2026-01-05', '2026-02-02', 4, 'week'],
    ['within two weeks', '2026-01-05', '2026-01-19', 2, 'week'],
    ['after 10 days', '2026-01-05', '2026-01-15', 10, 'day'],
    ['list after one month', '2026-01-31', '2026-02-28', 1, 'month'],
    ['List after twenty-one days', '2026-03-01', '2026-03-22', 21, 'day'],
    ['after a period of six weeks', '2026-12-20', '2027-01-31', 6, 'week'],
  ] as const)('%s from %s', (phrase, order, expected, n, unit) => {
    expect(resolveRelative(phrase, order)).toEqual({
      date: expected,
      derived: true,
      derivation: { basis: 'orderDate', n, unit, rule: RELATIVE_RULE },
    });
  });

  it('uses calendar months across a year end and applies no holiday adjustment', () => {
    expect(addInterval('2026-11-30', 3, 'month')).toBe('2027-02-28');
    // 2026-12-25 + 7 days is a Friday after the holiday; nothing moves it.
    expect(addInterval('2026-12-18', 1, 'week')).toBe('2026-12-25');
  });

  it('returns null where there is no relative phrase, and distinguishes after from within', () => {
    expect(resolveRelative('Post on 12.11.2026', '2026-01-05')).toBeNull();
    const found = findRelativePhrases('Counter within two weeks. List after four weeks.');
    expect(found.map((f) => f.preposition)).toEqual(['within', 'after']);
  });
});
