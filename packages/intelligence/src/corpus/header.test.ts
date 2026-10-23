import { describe, expect, it } from 'vitest';

import { courtOfCitation, extractJudgmentHeader } from './header.ts';

const MADRAS = `IN THE HIGH COURT OF JUDICATURE AT MADRAS
DATED: 21.10.2026
CORAM
THE HONOURABLE MR.JUSTICE A. FICTIONAL
W.P.No.12345 of 2026 and W.M.P.No.13001 of 2026
2026:MHC:1234
ORDER`;

describe('extractJudgmentHeader', () => {
  it('reads a Madras HC header', () => {
    expect(extractJudgmentHeader([MADRAS])).toEqual({
      neutralCitation: '2026:MHC:1234',
      court: 'MHC',
      caseNumbers: ['W.P.No.12345 of 2026', 'W.M.P.No.13001 of 2026'],
      bench: ['A. FICTIONAL'],
      judgmentDate: '2026-10-21',
    });
  });

  it('reads the slash form of a Madras citation', () => {
    expect(extractJudgmentHeader(['2026/MHC/77']).neutralCitation).toBe('2026:MHC:77');
  });

  it('reads Karnataka and Supreme Court citations', () => {
    expect(extractJudgmentHeader(['2026:KHC-D:567']).neutralCitation).toBe('2026:KHC-D:567');
    expect(extractJudgmentHeader(['2026 INSC 12']).court).toBe('INSC');
  });

  it('is total on empty input', () => {
    expect(extractJudgmentHeader([])).toEqual({
      neutralCitation: null,
      court: null,
      caseNumbers: [],
      bench: [],
      judgmentDate: null,
    });
  });

  it('does not take a date from the body', () => {
    expect(
      extractJudgmentHeader(['In the order dated 03.03.2019 the court']).judgmentDate,
    ).toBeNull();
  });

  it('reads the court from a canonical citation', () => {
    expect(courtOfCitation('2026:KHC:89-DB')).toBe('KHC');
    expect(courtOfCitation('nonsense')).toBeNull();
  });
});
