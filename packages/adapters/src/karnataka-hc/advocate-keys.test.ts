// Karnataka HC advocate keys (#404): Bar Registration Numbers as the stable key, raw names with
// alias sets, and rows without advocate columns.
import { describe, expect, it } from 'vitest';

import { AdvocateSchema } from '../types.ts';

import {
  extractBarRegistrationNo,
  karnatakaAdvocateAliases,
  karnatakaAdvocateKey,
  parseKarnatakaAdvocate,
  parseKarnatakaAdvocates,
} from './advocate-keys.ts';

describe('Karnataka HC advocate keys (#404)', () => {
  it('extracts a Bar Registration Number with a tolerant pattern', () => {
    expect(extractBarRegistrationNo('SRI A FICTIONAL (KAR/1234/2010)')).toBe('KAR/1234/2010');
    expect(extractBarRegistrationNo('kar / 99 / 2001')).toBe('KAR/99/2001');
    expect(extractBarRegistrationNo('MYS/123456/1999')).toBe('MYS/123456/1999');
    expect(extractBarRegistrationNo('K/1/2010')).toBeNull();
    expect(extractBarRegistrationNo('SRI A FICTIONAL')).toBeNull();
  });

  it('keys an advocate by BRN, else by the first alias', () => {
    const withBrn = parseKarnatakaAdvocate('Sri. A.B. Fictional, KAR/1234/2010');
    expect(AdvocateSchema.parse(withBrn)).toEqual({
      raw: 'Sri. A.B. Fictional, KAR/1234/2010',
      aliases: ['A B FICTIONAL', 'FICTIONAL A B'],
      enrolmentNo: 'KAR/1234/2010',
    });
    expect(karnatakaAdvocateKey(withBrn)).toBe('KAR/1234/2010');
    const nameOnly = parseKarnatakaAdvocate('  Smt. C. Fictional  ');
    expect(nameOnly).toEqual({ raw: 'Smt. C. Fictional', aliases: ['C FICTIONAL', 'FICTIONAL C'] });
    expect(karnatakaAdvocateKey(nameOnly)).toBe('C FICTIONAL');
  });

  it('strips titles and splits initials, never transliterating', () => {
    expect(karnatakaAdvocateAliases('M/s. Fictional Associates')).toEqual(['FICTIONAL ASSOCIATES']);
    expect(karnatakaAdvocateAliases('Sri. A. Fictional, Sr. Counsel for')).toEqual([
      'A FICTIONAL',
      'FICTIONAL A',
    ]);
    // A Kannada-script name has no Latin letters: no alias is invented from it.
    expect(parseKarnatakaAdvocate('ಶ್ರೀ ಕಾಲ್ಪನಿಕ')).toEqual({ raw: 'ಶ್ರೀ ಕಾಲ್ಪನಿಕ', aliases: [] });
  });

  it('splits several advocates per cell', () => {
    const { advocates, diagnostics } = parseKarnatakaAdvocates([
      'SRI A FICTIONAL, SMT B FICTIONAL',
      'SRI C FICTIONAL & SRI D FICTIONAL (KAR/7/2020)',
    ]);
    expect(diagnostics).toEqual([]);
    expect(advocates.map(karnatakaAdvocateKey)).toEqual([
      'A FICTIONAL',
      'B FICTIONAL',
      'C FICTIONAL',
      'KAR/7/2020',
    ]);
  });

  it('parses a row with no advocate columns as `advocates: []` with a diagnostic', () => {
    for (const cells of [undefined, []]) {
      expect(parseKarnatakaAdvocates(cells)).toEqual({
        advocates: [],
        diagnostics: [{ code: 'advocate_columns_missing' }],
      });
    }
  });
});
