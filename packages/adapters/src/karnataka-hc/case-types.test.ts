// Karnataka HC case types (#404): the verified codes, the unverified common ones, `partial`
// completeness and the normaliser mapping printed spellings to one code.
import { describe, expect, it } from 'vitest';

import { normaliseCaseType } from '../normalise/case-type.ts';

import {
  KARNATAKA_HC_CASE_TYPE_ALIASES,
  KARNATAKA_HC_CASE_TYPES,
  KARNATAKA_HC_CASE_TYPES_COMPLETENESS,
  karnatakaCaseTypeInfo,
} from './config/case-types.ts';
import { createKarnatakaHcAdapter } from './index.ts';

const options = { aliases: KARNATAKA_HC_CASE_TYPE_ALIASES, seatSuffixes: [] };

describe('Karnataka HC case types (#404)', () => {
  it('lists the verified types as verified', () => {
    for (const code of ['WP', 'WA', 'RFA', 'RSA', 'MFA', 'CRLP', 'CRLRP', 'CRLA']) {
      expect(karnatakaCaseTypeInfo(code), code).toMatchObject({ code, verified: true });
    }
  });

  it('flags the additional common types `verified: false`', () => {
    for (const code of ['CRP', 'CCC', 'CP', 'WPCR', 'COMMAP']) {
      expect(karnatakaCaseTypeInfo(code), code).toMatchObject({ code, verified: false });
    }
    expect(KARNATAKA_HC_CASE_TYPES.filter((t) => t.verified)).toHaveLength(8);
  });

  it('reports partial completeness until casetypes.pdf is captured (#119)', () => {
    expect(KARNATAKA_HC_CASE_TYPES_COMPLETENESS).toBe('partial');
    expect(createKarnatakaHcAdapter().caseTypeCompleteness).toBe('partial');
  });

  it('maps printed spellings to one code', () => {
    for (const raw of ['W.P.', 'WP', 'W. P.', 'Writ Petition']) {
      expect(normaliseCaseType(raw, options), raw).toBe('WP');
    }
    for (const raw of ['CRL.P', 'Crl.P.', 'CRL P', 'Criminal Petition']) {
      expect(normaliseCaseType(raw, options), raw).toBe('CRLP');
    }
    expect(normaliseCaseType('Comm.A.P', options)).toBe('COMMAP');
    expect(normaliseCaseType('WP (CR)', options)).toBe('WPCR');
  });

  it('never throws on an unknown type', () => {
    for (const raw of ['', 'XYZ', '(((', '12', 'Ω']) {
      expect(() => karnatakaCaseTypeInfo(raw)).not.toThrow();
      expect(() => normaliseCaseType(raw, options)).not.toThrow();
    }
    expect(karnatakaCaseTypeInfo('XYZ')).toBeUndefined();
  });
});
