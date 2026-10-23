// Duplicate proceedings (#362, AC of #33): case types match across punctuation and case, numbers
// without leading zeros, two-digit years expanded, CNR first. A 40-pair table must classify with
// 100% precision and recall. Pure: no database.
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import {
  expandYear,
  isSameProceeding,
  normaliseCaseNumber,
  normaliseCaseType,
  type ProceedingIdentity,
} from '../duplicates.ts';

const MADRAS = '0b5f6c4e-6b0c-4a53-9d43-0d1c1f0a0001';
const MADURAI = '0b5f6c4e-6b0c-4a53-9d43-0d1c1f0a0002';
const CNR_A = 'TNMH010012342026';
const CNR_B = 'TNMH010099992026';

const wp = (number: string, year: number, extra: ProceedingIdentity = {}): ProceedingIdentity => ({
  caseType: 'W.P.',
  number,
  year,
  ...extra,
});

/** [label, a, b, same proceeding?] */
const PAIRS: [string, ProceedingIdentity, ProceedingIdentity, boolean][] = [
  ['W.P. = WP', wp('1234', 2026), { caseType: 'WP', number: '1234', year: 2026 }, true],
  ['W.P. = w.p', wp('1234', 2026), { caseType: 'w.p', number: '1234', year: 2026 }, true],
  [
    'WP = w.p',
    { caseType: 'WP', number: '7', year: 2025 },
    { caseType: 'w.p', number: '7', year: 2025 },
    true,
  ],
  [
    'W. P. = WP',
    { caseType: 'W. P.', number: '7', year: 2025 },
    { caseType: 'WP', number: '7', year: 2025 },
    true,
  ],
  [
    'CRL.P = CRL P',
    { caseType: 'CRL.P', number: '88', year: 2024 },
    { caseType: 'CRL P', number: '88', year: 2024 },
    true,
  ],
  [
    'Crl.P. = CRLP',
    { caseType: 'Crl.P.', number: '88', year: 2024 },
    { caseType: 'CRLP', number: '88', year: 2024 },
    true,
  ],
  [
    'W.M.P. = WMP',
    { caseType: 'W.M.P.', number: '12', year: 2026 },
    { caseType: 'WMP', number: '12', year: 2026 },
    true,
  ],
  [
    'W.A. = W A',
    { caseType: 'W.A.', number: '300', year: 2026 },
    { caseType: 'W A', number: '300', year: 2026 },
    true,
  ],
  [
    'O.S.-A = OSA',
    { caseType: 'O.S.-A', number: '5', year: 2020 },
    { caseType: 'OSA', number: '5', year: 2020 },
    true,
  ],
  [
    'W.P.(MD) = WP(MD)',
    { caseType: 'W.P.(MD)', number: '45', year: 2026 },
    { caseType: 'WP(MD)', number: '45', year: 2026 },
    true,
  ],
  ['leading zeros 000123 = 123', wp('000123', 2026), wp('123', 2026), true],
  ['leading zeros 0045 = 45', wp('0045', 2026), wp('45', 2026), true],
  ['zero 0 = 00', wp('0', 2026), wp('00', 2026), true],
  ['number trimmed', wp(' 77 ', 2026), wp('77', 2026), true],
  ['number suffix case', wp('12a', 2026), wp('12A', 2026), true],
  ['two-digit year 26 = 2026', wp('1234', 26), wp('1234', 2026), true],
  ['two-digit year 05 = 2005', wp('9', 5), wp('9', 2005), true],
  ['two-digit year 49 = 2049', wp('9', 49), wp('9', 2049), true],
  ['two-digit year 50 = 1950', wp('9', 50), wp('9', 1950), true],
  ['two-digit year 99 = 1999', wp('9', 99), wp('9', 1999), true],
  [
    'all three normalisations',
    { caseType: 'crl.p.', number: '0088', year: 24 },
    { caseType: 'CRL P', number: '88', year: 2024 },
    true,
  ],
  ['same forum', wp('1', 2026, { forumId: MADRAS }), wp('1', 2026, { forumId: MADRAS }), true],
  ['one forum unknown', wp('1', 2026, { forumId: MADRAS }), wp('1', 2026), true],
  [
    'CNR equal, identity differs',
    wp('1', 2026, { cnr: CNR_A }),
    wp('2', 2025, { cnr: CNR_A }),
    true,
  ],
  ['CNR equal, case of CNR differs', { cnr: CNR_A.toLowerCase() }, { cnr: CNR_A }, true],
  ['CNR equal, only CNRs given', { cnr: CNR_A }, { cnr: ` ${CNR_A} ` }, true],
  ['one CNR, identity equal', wp('1', 2026, { cnr: CNR_A }), wp('1', 2026), true],
  [
    'CNR differs, identity equal',
    wp('1', 2026, { cnr: CNR_A }),
    wp('1', 2026, { cnr: CNR_B }),
    false,
  ],
  ['CNR differs, only CNRs given', { cnr: CNR_A }, { cnr: CNR_B }, false],
  ['different number', wp('1234', 2026), wp('1235', 2026), false],
  ['different year', wp('1234', 2026), wp('1234', 2025), false],
  ['two-digit year 26 != 1926', wp('1234', 26), wp('1234', 1926), false],
  ['WP != WMP', wp('12', 2026), { caseType: 'W.M.P.', number: '12', year: 2026 }, false],
  [
    'CRL.P != CRL.O.P',
    { caseType: 'CRL.P', number: '8', year: 2024 },
    { caseType: 'CRL.O.P', number: '8', year: 2024 },
    false,
  ],
  ['WP != WP(MD)', wp('45', 2026), { caseType: 'WP(MD)', number: '45', year: 2026 }, false],
  ['different suffix', wp('12A', 2026), wp('12B', 2026), false],
  ['inner zeros kept', wp('1010', 2026), wp('110', 2026), false],
  [
    'different forum',
    wp('1', 2026, { forumId: MADRAS }),
    wp('1', 2026, { forumId: MADURAI }),
    false,
  ],
  ['no number on one side', { caseType: 'WP', year: 2026 }, wp('1', 2026), false],
  ['one CNR, nothing else on the other side', { cnr: CNR_A }, wp('1', 2026), false],
];

describe('isSameProceeding', () => {
  it('has the 40-pair table', () => {
    expect(PAIRS).toHaveLength(40);
    expect(new Set(PAIRS.map(([label]) => label)).size).toBe(40);
  });

  it.each(PAIRS)('%s', (_label, a, b, same) => {
    expect(isSameProceeding(a, b)).toBe(same);
    expect(isSameProceeding(b, a)).toBe(same);
  });

  it('classifies the table with 100% precision and recall', () => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const [, a, b, same] of PAIRS) {
      const found = isSameProceeding(a, b);
      if (found && same) tp++;
      if (found && !same) fp++;
      if (!found && same) fn++;
    }
    expect(tp / (tp + fp)).toBe(1);
    expect(tp / (tp + fn)).toBe(1);
  });
});

describe('normaliseCaseType', () => {
  it('upper-cases and drops dots, whitespace, hyphens and underscores', () => {
    expect(normaliseCaseType('W.P.')).toBe('WP');
    expect(normaliseCaseType('w.p')).toBe('WP');
    expect(normaliseCaseType('CRL P')).toBe('CRLP');
    expect(normaliseCaseType('W.P.(MD)')).toBe('WP(MD)');
    expect(normaliseCaseType('o_s-a')).toBe('OSA');
  });

  it('is VALIDATION when nothing is left', () => {
    expect(() => normaliseCaseType(' . ')).toThrow(WorkspaceError);
  });
});

describe('normaliseCaseNumber and expandYear', () => {
  it('strips leading zeros of the digits only', () => {
    expect(normaliseCaseNumber('000123')).toBe('123');
    expect(normaliseCaseNumber('0')).toBe('0');
    expect(normaliseCaseNumber('0012a')).toBe('12A');
    expect(normaliseCaseNumber('A001')).toBe('A001');
  });

  it('expands two-digit years with the 50 pivot', () => {
    expect(expandYear(0)).toBe(2000);
    expect(expandYear(49)).toBe(2049);
    expect(expandYear(50)).toBe(1950);
    expect(expandYear(2026)).toBe(2026);
  });
});
