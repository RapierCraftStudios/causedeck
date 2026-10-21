// Normaliser tables (#369): case types, case numbers, two-digit years, stages, dates, neutral
// citations and match keys. Every case is a row; the suite asserts there are at least 60.
import { describe, expect, it } from 'vitest';

import {
  matchKey,
  normaliseCaseNumber,
  normaliseCaseType,
  normaliseDate,
  normaliseNeutralCitation,
  normaliseStage,
  parseCaseReference,
  parseCaseType,
} from '../normalise/index.ts';

const CASE_TYPES: [string, string | null, string?][] = [
  ['W.P.', 'WP'],
  ['WP', 'WP'],
  ['W. P.', 'WP'],
  ['w.p.', 'WP'],
  ['W.P', 'WP'],
  ['Crl.O.P.', 'CRLOP'],
  ['CRL OP', 'CRLOP'],
  ['Crl. O.P.', 'CRLOP'],
  ['CRL.OP', 'CRLOP'],
  ['Arb.O.P.', 'ARBOP'],
  ['ARB OP', 'ARBOP'],
  ['Arb. O. P.', 'ARBOP'],
  ['W.A.', 'WA'],
  ['C.M.A.', 'CMA'],
  ['Crl.R.C.', 'CRLRC'],
  ['S.A.', 'SA'],
  ['W.P.(MD)', 'WP', 'MD'],
  ['WP(MD)', 'WP', 'MD'],
  ['W.P. (MD)', 'WP', 'MD'],
  ['Crl.O.P.(MD)', 'CRLOP', 'MD'],
  ['CRL OP (MD)', 'CRLOP', 'MD'],
  ['W.M.P.', 'WMP'],
  ['  W.P.  ', 'WP'],
  ['', null],
  ['123', null],
  ['...', null],
];

const CASE_NUMBERS: [string, { number: string; year: number } | null, number?][] = [
  ['No. 12345 of 2026', { number: '12345', year: 2026 }],
  ['No.12345 of 2026', { number: '12345', year: 2026 }],
  ['12345 of 2026', { number: '12345', year: 2026 }],
  ['12345/2026', { number: '12345', year: 2026 }],
  ['12345 / 2026', { number: '12345', year: 2026 }],
  ['012345/2026', { number: '12345', year: 2026 }],
  ['No. 00042 of 2026', { number: '42', year: 2026 }],
  ['12345/26', { number: '12345', year: 2026 }],
  ['5 of 26', { number: '5', year: 2026 }],
  ['5/99', { number: '5', year: 1999 }],
  ['5/50', { number: '5', year: 2050 }],
  ['5/51', { number: '5', year: 1951 }],
  ['5/30', { number: '5', year: 1930 }, 20],
  ['5/20', { number: '5', year: 2020 }, 20],
  ['0/2026', { number: '0', year: 2026 }],
  ['W.P. No. 12345 of 2026', { number: '12345', year: 2026 }],
  ['12345-2026', { number: '12345', year: 2026 }],
  ['no number here', null],
  ['12345', null],
  ['12345/3026', null],
];

const DATES: [string, string | null][] = [
  ['21.10.2026', '2026-10-21'],
  ['21-10-2026', '2026-10-21'],
  ['21/10/2026', '2026-10-21'],
  ['1.2.2026', '2026-02-01'],
  ['21/10/26', '2026-10-21'],
  ['21 Oct 2026', '2026-10-21'],
  ['21st October, 2026', '2026-10-21'],
  ['21-OCT-2026', '2026-10-21'],
  ['2nd Sept 2026', '2026-09-02'],
  ['Dated: 05.01.2026', '2026-01-05'],
  ['31.02.2026', null],
  ['21 Foo 2026', null],
  ['no date', null],
];

const CITATIONS: [string, string | null][] = [
  ['2026:MHC:1234', '2026:MHC:1234'],
  ['2026 : mhc : 01234', '2026:MHC:1234'],
  ['Neutral Citation No. 2026:KHC-D:567', '2026:KHC-D:567'],
  ['2026:KHC:89-DB', '2026:KHC:89-DB'],
  ['2026 INSC 123', '2026 INSC 123'],
  ['2026 insc 0045', '2026 INSC 45'],
  ['no citation', null],
];

const STAGE_MAP = [
  { pattern: '^FOR\\s+ADMISSION$', flags: 'i', key: 'admission' },
  { pattern: '^FOR\\s+ORDERS$', flags: 'i', key: 'orders' },
  { pattern: '^MENTION', flags: 'i', key: 'mention' },
];

const STAGES: [string, string | null][] = [
  ['FOR ADMISSION', 'admission'],
  ['For  Admission', 'admission'],
  ['  FOR ORDERS  ', 'orders'],
  ['MENTION MEMOS', 'mention'],
  ['AFTER LUNCH SPECIAL SITTING', null],
  ['', null],
];

const TOTAL =
  CASE_TYPES.length + CASE_NUMBERS.length + DATES.length + CITATIONS.length + STAGES.length;

describe('normalisers', () => {
  it('has at least 60 table-driven cases', () => {
    expect(TOTAL).toBeGreaterThanOrEqual(60);
  });

  it('treats dotted, spaced and bare spellings of a case type as one', () => {
    expect(normaliseCaseType('W.P.')).toBe(normaliseCaseType('WP'));
    expect(normaliseCaseType('Crl.O.P.')).toBe(normaliseCaseType('CRL OP'));
  });

  it.each(CASE_TYPES)('case type %j -> %j (seat %j)', (raw, caseType, seatSuffix) => {
    const parsed = parseCaseType(raw);
    if (caseType === null) {
      expect(parsed).toBeNull();
      return;
    }
    expect(parsed).toEqual(seatSuffix === undefined ? { caseType } : { caseType, seatSuffix });
    expect(normaliseCaseType(raw)).toBe(caseType);
  });

  it('maps adapter aliases and only configured seat suffixes', () => {
    const options = { aliases: { WP: ['Writ Petition'] }, seatSuffixes: ['MD'] };
    expect(parseCaseType('Writ Petition', options)).toEqual({ caseType: 'WP' });
    expect(parseCaseType('W.P.(C)', options)).toEqual({ caseType: 'WPC' });
  });

  it.each(CASE_NUMBERS)('case number %j -> %j (pivot %j)', (raw, expected, pivot) => {
    expect(normaliseCaseNumber(raw, pivot === undefined ? {} : { pivot })).toEqual(expected);
  });

  it('splits a whole case reference', () => {
    expect(parseCaseReference('W.P.(MD) No. 0042 of 26')).toEqual({
      caseTypeRaw: 'W.P.(MD)',
      caseType: 'WP',
      seatSuffix: 'MD',
      number: '42',
      year: 2026,
    });
    expect(parseCaseReference('CRL OP 77/2026')).toMatchObject({ caseType: 'CRLOP', number: '77' });
    expect(parseCaseReference('nothing')).toBeNull();
  });

  it.each(DATES)('date %j -> %j', (raw, expected) => {
    expect(normaliseDate(raw)).toBe(expected);
  });

  it.each(CITATIONS)('neutral citation %j -> %j', (raw, expected) => {
    expect(normaliseNeutralCitation(raw)).toBe(expected);
  });

  it.each(STAGES)('stage %j -> %j, raw kept verbatim', (heading, key) => {
    expect(normaliseStage(heading, STAGE_MAP)).toEqual({ stageRaw: heading, stageNorm: key });
  });

  it('never throws on an unknown heading or an empty stage map', () => {
    expect(normaliseStage('ANYTHING (*) [', [])).toEqual({
      stageRaw: 'ANYTHING (*) [',
      stageNorm: null,
    });
  });

  it('gives two spellings of one case the same match key', () => {
    const a = parseCaseReference('W.P.(MD) No. 012 of 26');
    const b = parseCaseReference('WP(MD) 12/2026');
    const key = (r: typeof a) =>
      matchKey({
        caseType: r?.caseType ?? null,
        seatSuffix: r?.seatSuffix,
        caseNumber: r?.number ?? null,
        caseYear: r?.year ?? null,
      });
    expect(key(a)).toBe('WP(MD)/12/2026');
    expect(key(b)).toBe(key(a));
    expect(matchKey({ caseType: 'WP', caseNumber: null, caseYear: 2026 })).toBeNull();
  });
});
