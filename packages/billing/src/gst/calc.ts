// GST on SaaS invoices (#253, #29): 18% (`GST_RATE_BPS`) in exact integer paise.
//
// Remainder rule: the tax is computed once, `tax = round-half-up(taxable × 18%)`, in integer
// arithmetic (`floor((taxable × 1800 + 5000) / 10000)`). An intra-state supply (supplier state ===
// place of supply) splits it into `cgst = floor(tax / 2)` and `sgst = tax − cgst`, so SGST carries
// the odd paisa and CGST + SGST always equals the rounded 18%. An inter-state supply charges it all
// as IGST. In both cases `total = taxable + cgst + sgst + igst`.
import { GST_RATE_BPS } from '../plans';

import { isGstStateCode } from './state-codes';

const BPS = 10_000;

/** The largest taxable amount whose tax product stays a safe integer. */
export const MAX_TAXABLE_PAISE = Math.floor((Number.MAX_SAFE_INTEGER - BPS / 2) / GST_RATE_BPS);

export interface GstInput {
  /** Taxable value, integer paise. */
  taxable: number;
  /** Supplier's GST state code (two digits). */
  supplierState: string;
  /** Place of supply GST state code (two digits). */
  placeOfSupply: string;
}

/** Integer paise. */
export interface GstBreakdown {
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/** 18% of `taxable` paise, rounded half up to the paisa. */
export function gstOn(taxable: number): number {
  if (!Number.isSafeInteger(taxable) || taxable < 0 || taxable > MAX_TAXABLE_PAISE) {
    throw new RangeError('calcGst: taxable must be a non-negative integer number of paise');
  }
  return Math.floor((taxable * GST_RATE_BPS + BPS / 2) / BPS);
}

export function isIntraState(supplierState: string, placeOfSupply: string): boolean {
  return supplierState === placeOfSupply;
}

export function calcGst({ taxable, supplierState, placeOfSupply }: GstInput): GstBreakdown {
  if (!isGstStateCode(supplierState)) {
    throw new RangeError(`calcGst: unknown supplier state code ${JSON.stringify(supplierState)}`);
  }
  if (!isGstStateCode(placeOfSupply)) {
    throw new RangeError(`calcGst: unknown place of supply ${JSON.stringify(placeOfSupply)}`);
  }
  const tax = gstOn(taxable);
  if (isIntraState(supplierState, placeOfSupply)) {
    const cgst = Math.floor(tax / 2);
    return { cgst, sgst: tax - cgst, igst: 0, total: taxable + tax };
  }
  return { cgst: 0, sgst: 0, igst: tax, total: taxable + tax };
}
