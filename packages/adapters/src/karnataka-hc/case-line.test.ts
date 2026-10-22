// Karnataka HC case-line grammar (#404): the order shapes, bracketed writ categories, opaque
// numbers with the 100xxx hint, and IA children via `in WP No. ...`.
import { describe, expect, it } from 'vitest';

import { CaseRefSchema } from '../types.ts';

import { karnatakaBenchNumbering, parseKarnatakaCaseLine } from './case-line.ts';

const one = (line: string) => {
  const { refs, diagnostics } = parseKarnatakaCaseLine(line);
  expect(refs, line).toHaveLength(1);
  expect(diagnostics, line).toEqual([]);
  const [ref] = refs;
  if (ref === undefined) throw new Error(`no reference on ${line}`);
  expect(CaseRefSchema.safeParse(ref).success).toBe(true);
  return ref;
};

describe('Karnataka HC case-line grammar (#404)', () => {
  it('parses `WP No. 12345/2026` and `RFA No. 100/2024`', () => {
    expect(one('WP No. 12345/2026')).toEqual({
      caseTypeCode: 'WP',
      caseTypeRaw: 'WP',
      number: '12345',
      year: 2026,
      matchKey: 'WP/12345/2026',
    });
    expect(one('RFA No. 100/2024')).toMatchObject({ caseTypeCode: 'RFA', number: '100' });
  });

  it('stores the trailing bracketed category as subCategory', () => {
    expect(one('W.P. No. 12345 of 2026 (GM-RES)')).toEqual({
      caseTypeCode: 'WP',
      caseTypeRaw: 'W.P.',
      number: '12345',
      year: 2026,
      matchKey: 'WP/12345/2026',
      subCategory: 'GM-RES',
    });
  });

  it('keeps numbers opaque and sets the 100xxx hint at and above 100000 only', () => {
    expect(one('WA No. 100150 of 2024')).toMatchObject({
      caseTypeCode: 'WA',
      number: '100150',
      benchNumbering: '100xxx',
      matchKey: 'WA/100150/2024',
    });
    expect(one('CRL.P No. 100137 of 2025')).toMatchObject({
      caseTypeCode: 'CRLP',
      number: '100137',
      year: 2025,
      benchNumbering: '100xxx',
    });
    expect(one('RSA No. 5097 of 2010').benchNumbering).toBeUndefined();
    expect(karnatakaBenchNumbering('99999')).toBeUndefined();
    expect(karnatakaBenchNumbering('100000')).toBe('100xxx');
    // A leading zero is kept as printed: no arithmetic on the number.
    expect(one('WP No. 0012/2026').number).toBe('0012');
  });

  it('files `IA No. 1/2026 in WP No. ...` as a child of the writ', () => {
    const { refs, diagnostics } = parseKarnatakaCaseLine(
      'IA No. 1/2026 in WP No. 12345/2026 (GM-RES)',
    );
    expect(diagnostics).toEqual([]);
    expect(refs).toHaveLength(1);
    const [writ] = refs;
    expect(writ).toMatchObject({
      caseTypeCode: 'WP',
      matchKey: 'WP/12345/2026',
      subCategory: 'GM-RES',
    });
    expect(writ?.children).toEqual([
      {
        caseTypeCode: 'IA',
        caseTypeRaw: 'IA',
        number: '1',
        year: 2026,
        isMisc: true,
        matchKey: 'IA/1/2026',
        parentProceedingKey: 'WP/12345/2026',
      },
    ]);
  });

  it('keeps an unknown type with a diagnostic and never throws', () => {
    const { refs, diagnostics } = parseKarnatakaCaseLine('XYZ No. 7/2026');
    expect(refs[0]).toMatchObject({ caseTypeCode: 'XYZ', matchKey: 'XYZ/7/2026' });
    expect(diagnostics).toEqual([{ code: 'case_type_unknown', raw: 'XYZ' }]);
    for (const line of ['', 'no case here', '(((', 'WP No. /2026', 'x'.repeat(10_000)]) {
      expect(() => parseKarnatakaCaseLine(line)).not.toThrow();
    }
    expect(parseKarnatakaCaseLine('').refs).toEqual([]);
  });
});
