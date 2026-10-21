// Advocate matching keys (#395): enrolment numbers are the stable key; names are aliases, never
// transliterated. Names and numbers are FICTIONAL.
import { describe, expect, it } from 'vitest';

import { AdvocateSchema } from '../types.ts';

import { advocateAliases, advocateKey, extractEnrolmentNo, parseAdvocate } from './index.ts';

describe('advocate keys (#395)', () => {
  it('normalises `Mr. R. Fictional` and `R. FICTIONAL, Adv.` to the same alias set', () => {
    const a = advocateAliases('Mr. R. Fictional');
    const b = advocateAliases('R. FICTIONAL, Adv.');
    expect(a).toEqual(['R FICTIONAL', 'FICTIONAL R']);
    expect([...b].sort()).toEqual([...a].sort());
    expect(advocateAliases('Thiru R.K.Fictional')).toEqual(['R K FICTIONAL', 'FICTIONAL R K']);
  });

  it('extracts the enrolment number and uses it as the key', () => {
    expect(extractEnrolmentNo('MS/123/1900')).toBe('MS/123/1900');
    expect(extractEnrolmentNo('R. Fictional (ms / 4567/2011)')).toBe('MS/4567/2011');
    expect(extractEnrolmentNo('R. Fictional')).toBeNull();
    const advocate = parseAdvocate('  M/s. R. Fictional, MS/123/1900 ');
    expect(advocate).toEqual({
      raw: 'M/s. R. Fictional, MS/123/1900',
      aliases: ['R FICTIONAL', 'FICTIONAL R'],
      enrolmentNo: 'MS/123/1900',
    });
    expect(AdvocateSchema.safeParse(advocate).success).toBe(true);
    expect(advocateKey(advocate)).toBe('MS/123/1900');
    expect(advocateKey(parseAdvocate('Ms. S. Imaginary'))).toBe('S IMAGINARY');
  });

  it('keeps non-Latin names raw and does not invent aliases for them', () => {
    const advocate = parseAdvocate('திரு. கற்பனை');
    expect(advocate.raw).toBe('திரு. கற்பனை');
    expect(advocate.aliases).toEqual([]);
    expect(advocateKey(advocate)).toBeNull();
  });
});
