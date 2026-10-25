// FICTIONAL name pools for Karnataka HC synthetic fixtures (#408, part 5 of #37). Every party,
// advocate and judge is made up (most carry `Fictional`, `Example`, `Kalpita` or `Pretend` in the
// name) so no row can be taken for a real litigant; Kannada names appear as English lists print
// them. Bar Registration Numbers follow the assumed `KAR/<n>/<year>` form (ADR 0019). Kept short, so
// a name fits its column in a synthetic PDF list. Test tooling only: not exported from the package
// entry.
import { mulberry32 } from '../../testing/synthetic.ts';

export const PETITIONERS = [
  'Fictional Silks Ltd.',
  'K. Kalpita Gowda',
  'Pretend Growers Society',
  'Example Coffee Estates',
  'M. Imaginary Shetty',
  'S. Kalpita Rao',
  'Made-up Traders',
  'R. Fictional Naik',
] as const;

export const RESPONDENTS = [
  'State of Fictionland',
  'Example City Corporation',
  'Pretend Revenue Dept.',
  'The Fictional Bank',
  'Imaginary Panchayat',
  'Union of Fictionland',
] as const;

/** Advocates as lists print them; a few with a Bar Registration Number. */
export const ADVOCATES = [
  'Sri. A. Fictional',
  'Smt. B. Example',
  'Sri. K. Kalpita',
  'Smt. S. Pretend',
  'Sri. R. Madeup',
  'Sri. D. Imaginary',
] as const;

export const ENROLLED_ADVOCATES = [
  'Sri. A. Fictional KAR/1234/2001',
  'Smt. C. Example KAR/88/2015',
] as const;

/** Judges as list bench lines print them. */
export const JUDGES = [
  "HON'BLE MR. JUSTICE A. FICTIONAL",
  "HON'BLE MRS. JUSTICE B. EXAMPLE",
  "HON'BLE MR. JUSTICE C. KALPITA",
  "HON'BLE MS. JUSTICE D. PRETEND",
  "HON'BLE MR. JUSTICE E. IMAGINARY",
] as const;

/** Judges as an order's `BEFORE` block prints them. */
export const ORDER_JUDGES = [
  "THE HON'BLE MR JUSTICE A. FICTIONAL",
  "THE HON'BLE MRS JUSTICE B. EXAMPLE",
  "THE HON'BLE MR JUSTICE C. KALPITA",
  "THE HON'BLE MS JUSTICE D. PRETEND",
] as const;

/** A seeded choice from `pool`. */
export function pick<T>(random: () => number, pool: readonly T[]): T {
  return pool[Math.floor(random() * pool.length)] as T;
}

export { mulberry32 };
