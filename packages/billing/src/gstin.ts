// GSTIN validation (#28, #200). A GSTIN is 15 characters: 2-digit state code, 10-character PAN,
// entity number (1-9, A-Z), the letter Z, and a check digit over the first 14 characters (the GSTN
// mod-36 scheme). Captured on `subscription.gstin` for GST invoices (#29). The database checks the
// format only; the check digit is verified here.
//
// This module imports no other workspace (`@causedeck/db` uses `GSTIN_PATTERN_SOURCE`).

/** The format, as a regex source string shared with the `subscription_gstin_chk` constraint. */
export const GSTIN_PATTERN_SOURCE = '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';
export const GSTIN_PATTERN = new RegExp(GSTIN_PATTERN_SOURCE);

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export class InvalidGstinError extends Error {
  readonly code = 'INVALID_GSTIN';
  constructor(message = 'Enter a valid 15-character GSTIN.') {
    super(message);
    this.name = 'InvalidGstinError';
  }
}

/** The check digit for the first 14 characters of a GSTIN (uppercase). */
export function gstinCheckDigit(first14: string): string {
  if (first14.length !== 14) throw new RangeError('gstinCheckDigit: expected 14 characters');
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14.charAt(i));
    if (value === -1) throw new RangeError('gstinCheckDigit: invalid character');
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARSET.charAt((36 - (sum % 36)) % 36);
}

/** Format and check digit. Trims and uppercases first. */
export function isValidGstin(value: string): boolean {
  const gstin = value.trim().toUpperCase();
  return GSTIN_PATTERN.test(gstin) && gstinCheckDigit(gstin.slice(0, 14)) === gstin.charAt(14);
}

/**
 * The stored form of a GSTIN input: `null` when none is given (empty or blank), otherwise the
 * trimmed, uppercased GSTIN. Throws `InvalidGstinError` when it is not a valid GSTIN.
 */
export function normalizeGstin(value: string | null | undefined): string | null {
  const gstin = (value ?? '').trim().toUpperCase();
  if (gstin === '') return null;
  if (!isValidGstin(gstin)) throw new InvalidGstinError();
  return gstin;
}
