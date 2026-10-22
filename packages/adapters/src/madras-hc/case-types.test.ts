// Madras HC case-type table (#395): every code in research/raw/08 §8, misc parentage, `partial`.
import { describe, expect, it } from 'vitest';

import { compactCaseType } from '../normalise/case-type.ts';

import {
  caseTypeInfo,
  MADRAS_HC_CASE_TYPE_ALIASES,
  MADRAS_HC_CASE_TYPES,
  MADRAS_HC_CASE_TYPES_COMPLETENESS,
} from './index.ts';

/** As printed in research/raw/08 §8 (and the #395 acceptance criterion). */
const RESEARCH_CODES = [
  'WP',
  'WP Crl',
  'WMP',
  'WPMP',
  'WA',
  'WAMP',
  'WVMP',
  'VCMP',
  'REV.APLW',
  'CONT P',
  'CONT A',
  'HCP',
  'HCMP',
  'SA',
  'CMSA',
  'AS',
  'CMA',
  'CMA NPD',
  'CMA PD',
  'CRP',
  'CRP NPD',
  'CRP PD',
  'CMP',
  'CROS.OBJ',
  'TR CMA',
  'TR AS',
  'TR CMP',
  'REV.APLC',
  'CRL OP',
  'CRL MP',
  'CRL A',
  'CRL RC',
  'CRL REF',
  'RT',
  'CS',
  'OP',
  'OA',
  'OSA',
  'A',
  'APPL.',
  'SUB A',
  'SUB APPL',
  'OMS',
  'TOS',
  'LTS',
  'EP',
  'IP',
  'IA',
  'IC',
  'IN',
  'CP',
  'COMP.A',
  'COM APEL',
  'REV.APLO',
  'REV.PET',
  'TRCS',
  'ELP',
  'RCMP',
  'SCP',
  'SCMP',
  'C.S (COMM DIV)',
  'O.P (COMM DIV)',
  'APPEAL (CAD)',
  'OSA (CAD)',
  'Arb Appln',
  'Arb O.P',
  'Arb O.P (COM.DIV.)',
  'Arb Appeal',
  'Arb. E.P',
  '(T)OP(TM)',
  '(T)CMA(TM)',
  '(T)OP(CR)',
  '(T)OP(PT)',
  '(T)OP(GI)',
  'TC',
  'TCA',
  'TCP',
  'TCR',
  'TCMP',
  'TMA',
  'TMSA',
];

const MISC = [
  'WMP',
  'WPMP',
  'WAMP',
  'WVMP',
  'VCMP',
  'HCMP',
  'CRL MP',
  'CMP',
  'SUB A',
  'SUB APPL',
  'APPL.',
  'RCMP',
];

describe('Madras HC case types (#395)', () => {
  it.each(RESEARCH_CODES)('contains %s', (label) => {
    expect(caseTypeInfo(compactCaseType(label))?.label).toBe(label);
  });

  it('has unique codes, all in the config aliases, and reports partial completeness', () => {
    const codes = MADRAS_HC_CASE_TYPES.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(Object.keys(MADRAS_HC_CASE_TYPE_ALIASES).sort()).toEqual([...codes].sort());
    expect(MADRAS_HC_CASE_TYPES_COMPLETENESS).toBe('partial');
  });

  it('flags exactly the miscellaneous types, with their main-case codes', () => {
    const misc = MADRAS_HC_CASE_TYPES.filter((t) => t.isMisc === true).map((t) => t.label);
    expect(misc.sort()).toEqual([...MISC].sort());
    for (const label of MISC) {
      expect(caseTypeInfo(compactCaseType(label))?.parentCodes?.length, label).toBeGreaterThan(0);
    }
    expect(caseTypeInfo('WMP')?.parentCodes).toEqual(['WP']);
    expect(caseTypeInfo('WPMP')?.parentCodes).toEqual(['WP']);
    expect(caseTypeInfo('WAMP')?.parentCodes).toEqual(['WA']);
    expect(caseTypeInfo('CRLMP')?.parentCodes).toContain('CRLOP');
    expect(caseTypeInfo('HCMP')?.parentCodes).toEqual(['HCP']);
    // Every parent code is itself a known main type.
    for (const t of MADRAS_HC_CASE_TYPES) {
      for (const parent of t.parentCodes ?? []) {
        expect(caseTypeInfo(parent)?.isMisc, `${t.code} -> ${parent}`).toBeUndefined();
      }
    }
  });
});
