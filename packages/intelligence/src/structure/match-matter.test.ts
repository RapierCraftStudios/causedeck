import { describe, expect, it } from 'vitest';

import { rankMatters, spokenCaseNumbers, type MatterCandidate } from './match-matter.ts';

const A: MatterCandidate = {
  matterId: 'a',
  proceedingId: 'pa',
  caseNumbers: ['W.P. No. 12345 of 2026'],
  parties: ['Ravi Kumar', 'R. Kumar Traders'],
};
const B: MatterCandidate = {
  matterId: 'b',
  caseNumbers: ['W.P. No. 777 of 2025'],
  parties: ['Ravi Kumar Textiles'],
};
const C: MatterCandidate = { matterId: 'c', caseNumbers: [], parties: ['Meena Devi'] };

describe('spokenCaseNumbers', () => {
  it('normalises the spoken forms with the adapter normaliser', () => {
    const numbers = spokenCaseNumbers('case 12345 of 2026, also 00777/25 and 9/2024');
    expect(numbers).toEqual([
      { number: '12345', year: 2026 },
      { number: '777', year: 2025 },
      { number: '9', year: 2024 },
    ]);
  });
});

describe('rankMatters', () => {
  it('makes an L3-eligible match from an exact case number plus an agreeing listing', () => {
    const result = rankMatters('writ petition 12345/2026 today', [A, B, C], {
      caseNumber: 'W.P. 12345 of 2026',
    });
    expect(result.matched).toMatchObject({
      matterId: 'a',
      exact: 'case_number',
      contextAgrees: true,
    });
    expect(result.matched?.score).toBeGreaterThanOrEqual(0.9);
  });

  it('accepts a listing that names the matter id', () => {
    const result = rankMatters('12345 of 2026', [A, B], { matterId: 'a' });
    expect(result.matched?.matterId).toBe('a');
  });

  it('keeps an exact case number alone below 0.9 and offers candidates', () => {
    const result = rankMatters('12345 of 2026', [A, B, C]);
    expect(result.matched).toBeNull();
    expect(result.candidates[0]).toMatchObject({ matterId: 'a', exact: 'case_number' });
    expect(result.candidates[0]?.score).toBeLessThan(0.9);
  });

  it('never matches on party names alone and lists at most three candidates', () => {
    const many = ['d', 'e', 'f', 'g'].map((id) => ({
      matterId: id,
      caseNumbers: [],
      parties: ['Ravi Kumar'],
    }));
    const result = rankMatters('the Ravi Kumar matter', [A, B, ...many]);
    expect(result.matched).toBeNull();
    expect(result.candidates).toHaveLength(3);
  });

  it('matches party aliases and ignores a single shared word of a long name', () => {
    expect(rankMatters('R Kumar Traders', [A]).candidates[0]?.matterId).toBe('a');
    expect(rankMatters('Kumar', [A, B]).candidates).toEqual([]);
  });

  it('has no candidates without an identifier, context or party name', () => {
    expect(rankMatters('the hearing went well', [A, B, C])).toEqual({
      matched: null,
      candidates: [],
    });
  });

  it('does not auto-match when two matters tie', () => {
    const twin = { ...A, matterId: 'a2' };
    const result = rankMatters('12345 of 2026', [A, twin], { caseNumber: '12345/2026' });
    expect(result.matched).toBeNull();
    expect(result.candidates).toHaveLength(2);
  });
});
