import type { Locale } from '../locales';

import { formatIndianGrouping } from './number';

export interface FormatInrOptions {
  /** Accepted for API symmetry: en, ta and kn all render `₹` with Indian grouping. */
  locale?: Locale;
  /** `₹12.35 L` / `₹1.23 Cr` instead of the full amount, from one lakh upwards. */
  compact?: boolean;
}

const LAKH = 10_000_000n; // in paise
const CRORE = 1_000_000_000n;

function toPaise(paise: number | bigint): bigint {
  if (typeof paise === 'bigint') return paise;
  if (!Number.isSafeInteger(paise))
    throw new RangeError(`INR amounts are integer paise: ${String(paise)}`);
  return BigInt(paise);
}

/** `hundredths` (e.g. 1235n) as `12.35`, grouped the Indian way. */
function twoDecimals(hundredths: bigint): string {
  const whole = formatIndianGrouping((hundredths / 100n).toString());
  return `${whole}.${(hundredths % 100n).toString().padStart(2, '0')}`;
}

function compact(abs: bigint): string | undefined {
  if (abs < LAKH) return undefined;
  // Round half up in integer arithmetic; 99.995 L rounds to 1.00 Cr rather than 100.00 L.
  const lakhs = (abs * 100n + LAKH / 2n) / LAKH;
  if (abs < CRORE && lakhs < 10_000n) return `${twoDecimals(lakhs)} L`;
  return `${twoDecimals((abs * 100n + CRORE / 2n) / CRORE)} Cr`;
}

/** Formats an amount in integer paise as rupees: `formatInr(123456789)` is `₹12,34,567.89`. */
export function formatInr(paise: number | bigint, opts: FormatInrOptions = {}): string {
  const value = toPaise(paise);
  const sign = value < 0n ? '-' : '';
  const abs = value < 0n ? -value : value;
  const body = (opts.compact === true ? compact(abs) : undefined) ?? twoDecimals(abs);
  return `${sign}₹${body}`;
}
