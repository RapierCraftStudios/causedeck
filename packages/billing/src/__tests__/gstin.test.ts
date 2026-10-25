import { describe, expect, it } from 'vitest';

import {
  GSTIN_PATTERN,
  gstinCheckDigit,
  InvalidGstinError,
  isValidGstin,
  normalizeGstin,
} from '../gstin';

// Published example GSTINs with correct check digits.
const VALID = ['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '33AAACH7409R1Z8', '29AABCU9603R1ZJ'];

describe('GSTIN validation', () => {
  it.each(VALID)('accepts %s', (gstin) => {
    expect(GSTIN_PATTERN.test(gstin)).toBe(true);
    expect(gstinCheckDigit(gstin.slice(0, 14))).toBe(gstin.charAt(14));
    expect(isValidGstin(gstin)).toBe(true);
  });

  it.each(VALID)('rejects %s with any other check digit', (gstin) => {
    for (const digit of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (digit === gstin.charAt(14)) continue;
      expect(isValidGstin(gstin.slice(0, 14) + digit)).toBe(false);
    }
  });

  it('rejects malformed values', () => {
    for (const bad of [
      '',
      '27AAPFU0939F1Z', // 14 characters
      '27AAPFU0939F1ZVX', // 16 characters
      '27AAPFU0939F1YV', // 14th character is not Z
      '27AAPFU0939F0ZV', // entity number 0
      'A7AAPFU0939F1ZV', // state code not numeric
      '27AAPF00939F1ZV', // PAN letters
    ]) {
      expect(isValidGstin(bad), bad).toBe(false);
    }
  });

  it('normalizes case and whitespace and treats blank as not provided', () => {
    expect(normalizeGstin('  27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(normalizeGstin('')).toBeNull();
    expect(normalizeGstin('   ')).toBeNull();
    expect(normalizeGstin(null)).toBeNull();
    expect(normalizeGstin(undefined)).toBeNull();
  });

  it('throws a typed error for an invalid GSTIN', () => {
    expect(() => normalizeGstin('27AAPFU0939F1ZA')).toThrow(InvalidGstinError);
    try {
      normalizeGstin('27AAPFU0939F1ZA');
    } catch (error) {
      expect((error as InvalidGstinError).code).toBe('INVALID_GSTIN');
    }
  });

  it('guards the check-digit input', () => {
    expect(() => gstinCheckDigit('27AAPFU0939F1')).toThrow(RangeError);
    expect(() => gstinCheckDigit('27aapfu0939f1z')).toThrow(RangeError);
  });
});
