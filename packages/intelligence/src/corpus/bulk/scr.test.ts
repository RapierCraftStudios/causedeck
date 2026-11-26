import { describe, expect, it } from 'vitest';

import { parseScrCitation } from './scr.ts';

describe('parseScrCitation', () => {
  it('reads the SCR citation of an English member', () => {
    expect(parseScrCitation('2008_9_821_869_EN.pdf')).toBe('[2008] 9 SCR 821');
    expect(parseScrCitation('2019_14_1_12_en.PDF')).toBe('[2019] 14 SCR 1');
    // Leading zeros are not part of the citation.
    expect(parseScrCitation('1999_03_0045_0050_EN.pdf')).toBe('[1999] 3 SCR 45');
    // A single-page judgment starts and ends on the same page.
    expect(parseScrCitation('2023_1_500_500_EN.pdf')).toBe('[2023] 1 SCR 500');
  });

  it('tolerates a directory prefix in the member name', () => {
    expect(parseScrCitation('english/2008_9_821_869_EN.pdf')).toBe('[2008] 9 SCR 821');
    expect(parseScrCitation('a\\b\\2008_9_821_869_EN.pdf')).toBe('[2008] 9 SCR 821');
  });

  it('yields no citation for a regional-language member', () => {
    for (const lang of ['HI', 'TA', 'KN', 'mr', 'BEN', 'ODI'])
      expect(parseScrCitation(`2008_9_821_869_${lang}.pdf`)).toBeNull();
  });

  it('yields no citation for a malformed name', () => {
    for (const name of [
      '',
      'a.pdf',
      '2008_9_821_EN.pdf',
      '2008_9_821_869.pdf',
      '2008_9_821_869_EN.txt',
      '2008_9_821_869_EN.pdf.gz',
      '2008_IX_821_869_EN.pdf',
      '08_9_821_869_EN.pdf',
      '2008_9_869_821_EN.pdf',
      '2008_0_821_869_EN.pdf',
      '2008_9_0_0_EN.pdf',
      '1900_9_821_869_EN.pdf',
      'x2008_9_821_869_EN.pdf',
      '2008_9_821_869_EN_1.pdf',
      '2008-9-821-869-EN.pdf',
    ])
      expect(parseScrCitation(name), name).toBeNull();
  });
});
