import { describe, expect, it } from 'vitest';

import { calcGst, gstOn, MAX_TAXABLE_PAISE } from '../gst/calc';
import { DEFAULT_SAC, isValidSac, resolveSac } from '../gst/sac';
import { GST_STATE_CODES, isGstStateCode, stateCodeFromGstin } from '../gst/state-codes';
import { InvalidGstinError } from '../gstin';

const MH = '27';
const KA = '29';

/** 18% of `taxable`, rounded half up, computed independently with BigInt. */
function expectedTax(taxable: number): number {
  const product = BigInt(taxable) * 18n;
  return Number((product + 50n) / 100n);
}

/** Deterministic PRNG (mulberry32) so a failure reproduces. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('calcGst', () => {
  it('splits an intra-state supply 9% + 9%', () => {
    expect(calcGst({ taxable: 99_900, supplierState: MH, placeOfSupply: MH })).toEqual({
      cgst: 8_991,
      sgst: 8_991,
      igst: 0,
      total: 117_882,
    });
  });

  it('charges an inter-state supply 18% IGST', () => {
    expect(calcGst({ taxable: 99_900, supplierState: MH, placeOfSupply: KA })).toEqual({
      cgst: 0,
      sgst: 0,
      igst: 17_982,
      total: 117_882,
    });
  });

  it('rounds the 18% half up and gives the odd paisa to SGST', () => {
    // 18% of 3 paise = 0.54 -> 1 paisa: CGST 0, SGST 1.
    expect(calcGst({ taxable: 3, supplierState: MH, placeOfSupply: MH })).toEqual({
      cgst: 0,
      sgst: 1,
      igst: 0,
      total: 4,
    });
    // 18% of 25 paise = 4.5 -> 5 (half up): CGST 2, SGST 3.
    expect(calcGst({ taxable: 25, supplierState: MH, placeOfSupply: MH })).toEqual({
      cgst: 2,
      sgst: 3,
      igst: 0,
      total: 30,
    });
    // 18% of 2 paise = 0.36 -> 0.
    expect(gstOn(2)).toBe(0);
  });

  it('is zero on a zero taxable value', () => {
    expect(calcGst({ taxable: 0, supplierState: MH, placeOfSupply: KA })).toEqual({
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: 0,
    });
  });

  it.each([-1, 1.5, Number.NaN, MAX_TAXABLE_PAISE + 1])('rejects taxable %s', (taxable) => {
    expect(() => calcGst({ taxable, supplierState: MH, placeOfSupply: MH })).toThrow(RangeError);
  });

  it('rejects unknown state codes', () => {
    expect(() => calcGst({ taxable: 100, supplierState: '00', placeOfSupply: MH })).toThrow(
      RangeError,
    );
    expect(() => calcGst({ taxable: 100, supplierState: MH, placeOfSupply: '99' })).toThrow(
      RangeError,
    );
  });

  it('is exact over 10,000 random amounts: taxable + taxes == total', () => {
    const random = prng(253);
    const codes = Object.keys(GST_STATE_CODES);
    const failures: object[] = [];
    let checked = 0;
    for (let i = 0; i < 10_000; i++) {
      // Mix small amounts (rounding edges) with large ones up to Rs 10 crore.
      const max = i % 2 === 0 ? 1_000 : 10_000_000_000;
      const taxable = Math.floor(random() * max);
      const supplierState = codes[Math.floor(random() * codes.length)] ?? MH;
      const placeOfSupply =
        random() < 0.5 ? supplierState : (codes[Math.floor(random() * codes.length)] ?? KA);
      const gst = calcGst({ taxable, supplierState, placeOfSupply });
      const tax = expectedTax(taxable);
      const intra = supplierState === placeOfSupply;
      const ok =
        taxable + gst.cgst + gst.sgst + gst.igst === gst.total &&
        [gst.cgst, gst.sgst, gst.igst].every(Number.isSafeInteger) &&
        (intra
          ? gst.cgst + gst.sgst === tax &&
            gst.sgst - gst.cgst >= 0 &&
            gst.sgst - gst.cgst <= 1 &&
            gst.igst === 0
          : gst.igst === tax && gst.cgst === 0 && gst.sgst === 0);
      // One expect at the end keeps 10,000 iterations fast; collect what failed.
      if (!ok) failures.push({ taxable, supplierState, placeOfSupply, ...gst, tax });
      checked++;
    }
    expect(checked).toBe(10_000);
    expect(failures).toEqual([]);
  });
});

describe('state codes', () => {
  it('knows the GST codes', () => {
    expect(GST_STATE_CODES['27']).toBe('Maharashtra');
    expect(GST_STATE_CODES['38']).toBe('Ladakh');
    expect(isGstStateCode('97')).toBe(true);
    expect(isGstStateCode('00')).toBe(false);
    expect(isGstStateCode('toString')).toBe(false);
  });

  it('reads the state code from a valid GSTIN only', () => {
    expect(stateCodeFromGstin('29AAGCB7383J1Z4')).toBe('29');
    expect(stateCodeFromGstin(' 27aapfu0939f1zv ')).toBe('27');
    expect(() => stateCodeFromGstin('29AAGCB7383J1Z5')).toThrow(InvalidGstinError);
  });
});

describe('SAC', () => {
  it('defaults to 998314 and validates configured codes', () => {
    expect(DEFAULT_SAC).toBe('998314');
    expect(resolveSac(undefined)).toBe('998314');
    expect(resolveSac(' ')).toBe('998314');
    expect(resolveSac('998315')).toBe('998315');
    expect(isValidSac('123456')).toBe(false);
    expect(() => resolveSac('12345')).toThrow(RangeError);
  });
});
