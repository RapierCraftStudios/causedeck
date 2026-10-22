import { describe, expect, it } from 'vitest';

import {
  DEFAULT_END_OF_DAY_TIME,
  DigestPreferenceSchema,
  EndOfDayTimeSchema,
} from './digest-preferences';

describe('digest.end_of_day preference', () => {
  it('defaults to on, 20:30 and counts only (no names)', () => {
    expect(DigestPreferenceSchema.parse({})).toEqual({
      enabled: true,
      time: DEFAULT_END_OF_DAY_TIME,
      includeNames: false,
    });
    expect(DEFAULT_END_OF_DAY_TIME).toBe('20:30');
  });

  it('accepts :00 and :30 from 18:00 to 23:00 only', () => {
    for (const ok of ['18:00', '18:30', '20:30', '22:30', '23:00'])
      expect(EndOfDayTimeSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['17:30', '23:30', '20:15', '7:30', '20:30:00', '25:00', 'evening'])
      expect(EndOfDayTimeSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(DigestPreferenceSchema.safeParse({ enabled: true, extra: 1 }).success).toBe(false);
  });
});
