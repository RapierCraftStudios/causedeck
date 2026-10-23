import { describe, expect, it } from 'vitest';

import {
  DATE_FORMATS,
  datePresence,
  findDateLiterals,
  renderDate,
  type DateFormat,
} from './dates.ts';

/** A small seeded generator: the property test must be reproducible. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const iso = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

describe('datePresence', () => {
  const cases: [string, string][] = [
    ['dd.mm.yyyy', 'Post on 12.11.2026 for orders.'],
    ['dd/mm/yyyy', 'Post on 12/11/2026 for orders.'],
    ['dd-mm-yyyy', 'Post on 12-11-2026 for orders.'],
    ['ordinal month', 'Post on 12th November, 2026 for orders.'],
    ['month first', 'Post on November 12, 2026 for orders.'],
    ['two-digit year', 'Post on 12.11.26 for orders.'],
    ['Tamil digits', 'Post on ௧௨.௧௧.௨௦௨௬ for orders.'],
    ['Kannada digits', 'Post on ೧೨.೧೧.೨೦೨೬ for orders.'],
    ['Tamil month name', 'Post on 12 நவம்பர் 2026 for orders.'],
  ];
  it.each(cases)('finds a literal written as %s', (_name, text) => {
    expect(datePresence('2026-11-12', text)?.date).toBe('2026-11-12');
  });

  it('returns the offsets of the literal in the original text', () => {
    const text = 'Post on ௧௨.௧௧.௨௦௨௬ for orders.';
    const hit = datePresence('2026-11-12', text);
    expect(text.slice(hit?.start, hit?.end)).toBe('௧௨.௧௧.௨௦௨௬');
  });

  it('rejects a date that has no literal rendering in the text', () => {
    expect(datePresence('2026-11-13', 'Post on 12.11.2026 for orders.')).toBeNull();
    expect(datePresence('2026-11-12', 'Post after four weeks.')).toBeNull();
  });

  it('reads numeric dates day first, and refuses impossible dates', () => {
    expect(findDateLiterals('on 03.04.2026').map((d) => d.date)).toEqual(['2026-04-03']);
    expect(findDateLiterals('on 31.02.2026 and 13/13/2026')).toEqual([]);
  });

  it('property: every generated date written in any format is found, and only that date', () => {
    const next = lcg(46);
    let checked = 0;
    for (let i = 0; i < 2000; i++) {
      const year = 1990 + Math.floor(next() * 80);
      const month = 1 + Math.floor(next() * 12);
      const day = 1 + Math.floor(next() * 28);
      const date = iso(year, month, day);
      const format: DateFormat = DATE_FORMATS[
        Math.floor(next() * DATE_FORMATS.length)
      ] as DateFormat;
      // Two-digit years read as 20yy: only generate those for 2000-2079.
      if (format === 'dd.mm.yy' && year < 2000) continue;
      const digits = i % 7 === 0 ? (i % 2 === 0 ? 'ta' : 'kn') : undefined;
      const text = `The matter is posted to ${renderDate(date, format, digits)} for hearing.`;
      const found = findDateLiterals(text);
      expect(
        found.map((f) => f.date),
        text,
      ).toEqual([date]);
      const other = iso(year, month === 12 ? 1 : month + 1, day);
      expect(datePresence(other, text), text).toBeNull();
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1800);
  });
});
