// Madras HC case-line grammar (#395): the acceptance lines, misc parentage, ranges, `(MD)` and
// unknown types. Case numbers are FICTIONAL.
import { describe, expect, it } from 'vitest';

import { CaseRefSchema, type CaseRef } from '../types.ts';

import { MAX_RANGE_ITEMS, parseCaseLine } from './index.ts';

const keys = (refs: CaseRef[]) => refs.map((ref) => ref.matchKey);

describe('parseCaseLine (#395)', () => {
  it.each([
    ['W.P.No.12345 of 2026', 'WP/12345/2026'],
    ['WP No. 12345/2026', 'WP/12345/2026'],
    ['W.P.(MD)No.678 of 2026', 'WP(MD)/678/2026'],
    ['Crl.O.P.No.0042 of 26', 'CRLOP/42/2026'],
    ['(T)OP(TM) No. 5 of 2026', 'TOPTM/5/2026'],
    ['C.S (COMM DIV) No. 7 of 2026', 'CSCOMMDIV/7/2026'],
  ])('reads %s', (line, key) => {
    const parsed = parseCaseLine(line);
    expect(keys(parsed.refs)).toEqual([key]);
    expect(parsed.diagnostics).toEqual([]);
    for (const ref of parsed.refs) expect(CaseRefSchema.safeParse(ref).success).toBe(true);
  });

  it('tags a (MD) reference on a Principal Seat line instead of dropping it', () => {
    const parsed = parseCaseLine('W.P.(MD)No.678 of 2026');
    expect(parsed.refs[0]).toMatchObject({ caseTypeCode: 'WP', seatSuffix: 'MD', number: '678' });
    expect(parsed.forumMismatch).toBe(true);
    expect(parseCaseLine('W.P.No.678 of 2026').forumMismatch).toBe(false);
    expect(parseCaseLine('W.P.(MD)No.678 of 2026', { forumSeat: 'MD' }).forumMismatch).toBe(false);
  });

  it('files miscellaneous petitions on the same line within the main case', () => {
    const parsed = parseCaseLine('CRL OP No.4567 of 2026 and Crl.M.P.Nos.1 & 2 of 2026');
    expect(keys(parsed.refs)).toEqual(['CRLOP/4567/2026']);
    const [main] = parsed.refs;
    expect(main?.children).toEqual([
      expect.objectContaining({
        caseTypeCode: 'CRLMP',
        number: '1',
        isMisc: true,
        parentProceedingKey: 'CRLOP/4567/2026',
      }),
      expect.objectContaining({
        caseTypeCode: 'CRLMP',
        number: '2',
        isMisc: true,
        parentProceedingKey: 'CRLOP/4567/2026',
      }),
    ]);
    expect(CaseRefSchema.safeParse(main).success).toBe(true);
  });

  it('files WMPs within their writ petition', () => {
    const parsed = parseCaseLine('W.P.No.100 of 2026 and W.M.P.Nos.200 & 201 of 2026');
    expect(keys(parsed.refs)).toEqual(['WP/100/2026']);
    expect(parsed.refs[0]?.children?.map((c) => c.parentProceedingKey)).toEqual([
      'WP/100/2026',
      'WP/100/2026',
    ]);
  });

  it('expands a range to one reference per number', () => {
    const parsed = parseCaseLine('W.M.P.Nos.13001 to 13003 of 2026');
    expect(keys(parsed.refs)).toEqual(['WMP/13001/2026', 'WMP/13002/2026', 'WMP/13003/2026']);
  });

  it('keeps only the ends of an oversized range, with a diagnostic', () => {
    const parsed = parseCaseLine(`W.M.P.Nos.1 to ${String(MAX_RANGE_ITEMS + 5)} of 2026`);
    expect(parsed.refs).toHaveLength(2);
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['range_too_large']);
  });

  it('files `X in Y` within Y', () => {
    const parsed = parseCaseLine('O.A.Nos.1 and 2 of 2026 in C.S.No.9 of 2026');
    expect(keys(parsed.refs)).toEqual(['CS/9/2026']);
    expect(parsed.refs[0]?.children?.map((c) => [c.matchKey, c.parentProceedingKey])).toEqual([
      ['OA/1/2026', 'CS/9/2026'],
      ['OA/2/2026', 'CS/9/2026'],
    ]);
  });

  it('keeps an unknown type as free text with a case_type_unknown diagnostic', () => {
    const parsed = parseCaseLine('Zq.Pet.No.5 of 2026');
    expect(parsed.refs).toEqual([
      expect.objectContaining({ caseTypeRaw: 'Zq.Pet.', caseTypeCode: 'ZQPET', number: '5' }),
    ]);
    expect(parsed.diagnostics).toEqual([{ code: 'case_type_unknown', raw: 'Zq.Pet.' }]);
  });

  it('never throws on noise', () => {
    const noise = [
      '',
      '   ',
      'No. of 2026',
      'FICTIONAL PARTY vs FICTIONAL STATE',
      '((((((((',
      'W.P.No.1 of 1850',
      `${'A '.repeat(3000)}1 of 2026`,
      'W.P.Nos.1 to of 2026',
      'in in in W.P.No.3 of 2026',
    ];
    for (const line of noise) {
      expect(() => parseCaseLine(line), line.slice(0, 30)).not.toThrow();
    }
    expect(parseCaseLine('FICTIONAL PARTY vs FICTIONAL STATE').refs).toEqual([]);
  });
});
