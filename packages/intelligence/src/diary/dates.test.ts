import { describe, expect, it } from 'vitest';

import { asciiDigits, datePresence } from './dates.ts';

describe('datePresence', () => {
  it('finds numeric dates, with or without a year', () => {
    expect(datePresence('2026-10-12', 'Next date 12/10/2026')).toBe(true);
    expect(datePresence('2026-10-12', 'posted to 12-10-26')).toBe(true);
    expect(datePresence('2026-10-12', 'list on 12.10')).toBe(true);
  });

  it('finds English month names in either order', () => {
    expect(datePresence('2026-10-12', 'adjourned to 12th October 2026')).toBe(true);
    expect(datePresence('2026-10-12', 'next: Oct 12, 2026')).toBe(true);
    expect(datePresence('2026-03-04', 'on 4 Mar')).toBe(true);
  });

  it('finds Tamil and Kannada month names and numerals', () => {
    expect(datePresence('2026-10-12', 'அடுத்த தேதி 12 அக்டோபர் 2026')).toBe(true);
    expect(datePresence('2026-10-12', 'ಮುಂದಿನ ದಿನಾಂಕ 12 ಅಕ್ಟೋಬರ್ 2026')).toBe(true);
    expect(datePresence('2026-10-12', '௧௨/௧௦/௨௦௨௬')).toBe(true);
    expect(asciiDigits('௧௨ ೧೨')).toBe('12 12');
  });

  it('rejects a date that is not written', () => {
    expect(datePresence('2026-10-13', 'Next date 12/10/2026')).toBe(false);
    expect(datePresence('2026-10-12', 'adjourned to 12 Oct 2027')).toBe(false);
    expect(datePresence('2026-10-12', 'arguments heard')).toBe(false);
    expect(datePresence('2026-02-30', '30/02/2026')).toBe(false);
  });

  it('does not read a case number as a date', () => {
    expect(datePresence('2026-12-20', 'WP 123/2026')).toBe(false);
  });

  it('does not match a month name inside a longer word', () => {
    expect(datePresence('2026-03-04', 'Marked 4 for hearing')).toBe(false);
  });
});
