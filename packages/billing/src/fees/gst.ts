// GST on fee invoices (#83, part 2): pure integer-paise maths for the legal-gated fees domain.
// Rates and the treatment mapping come from `gst-config/in-2026.json`, whose values are placeholders
// (`reviewed: false`) until counsel and a CA sign them off. Rounding follows `../gst/calc.ts`:
// the tax is rounded half up once, then split CGST = floor(tax / 2), SGST = the rest.
import type { GstTreatment } from '@causedeck/validators/fees';

import { isGstStateCode } from '../gst/state-codes';

import config from './gst-config/in-2026.json';

const BPS = 10_000;

/** How GST applies to a supply: forward charge, reverse charge, exempt, or supplier unregistered. */
export type FeeGstMode = 'regular' | 'rcm' | 'exempt' | 'unregistered';

export const FEE_GST_CONFIG = config;

export interface FeeGstInput {
  /** Taxable value, integer paise. */
  taxablePaise: number;
  /** A fee mode or a validators `GstTreatment`. */
  treatment: FeeGstMode | GstTreatment;
  supplierState: string;
  placeOfSupply: string;
}

/** Integer paise. `rcmPaise` is tax the recipient pays; it is not part of `total`. */
export interface FeeGstBreakdown {
  mode: FeeGstMode;
  cgst: number;
  sgst: number;
  igst: number;
  rcmPaise: number;
  total: number;
}

/** The fee mode of a treatment (a mode maps to itself). */
export function feeGstMode(treatment: FeeGstMode | GstTreatment): FeeGstMode {
  if (treatment in config.treatments) return treatment as FeeGstMode;
  const mapped = (config.mapping as Record<string, FeeGstMode | undefined>)[treatment];
  if (!mapped) throw new RangeError(`computeGst: unknown treatment ${JSON.stringify(treatment)}`);
  return mapped;
}

export function computeGst(input: FeeGstInput): FeeGstBreakdown {
  const { taxablePaise, supplierState, placeOfSupply } = input;
  const mode = feeGstMode(input.treatment);
  const rule = config.treatments[mode];
  const maxTaxable = Math.floor((Number.MAX_SAFE_INTEGER - BPS / 2) / Math.max(rule.rateBps, 1));
  if (!Number.isSafeInteger(taxablePaise) || taxablePaise < 0 || taxablePaise > maxTaxable) {
    throw new RangeError('computeGst: taxable must be a non-negative integer number of paise');
  }
  if (!isGstStateCode(supplierState) || !isGstStateCode(placeOfSupply)) {
    throw new RangeError('computeGst: unknown GST state code');
  }
  const tax = Math.floor((taxablePaise * rule.rateBps + BPS / 2) / BPS);
  if (!rule.chargedToRecipient) {
    return {
      mode,
      cgst: 0,
      sgst: 0,
      igst: 0,
      rcmPaise: mode === 'rcm' ? tax : 0,
      total: taxablePaise,
    };
  }
  const intra = supplierState === placeOfSupply;
  const cgst = intra ? Math.floor(tax / 2) : 0;
  const sgst = intra ? tax - cgst : 0;
  const igst = intra ? 0 : tax;
  return { mode, cgst, sgst, igst, rcmPaise: 0, total: taxablePaise + tax };
}
