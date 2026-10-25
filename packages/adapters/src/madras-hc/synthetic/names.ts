// FICTIONAL name pools for Madras HC synthetic fixtures (#396, part 2 of #36). Every party, advocate
// and judge is made up (several carry `Fictional` or `Example` in the name) so no row can be taken
// for a real litigant; Tamil names appear as English lists print them, never transliterated.
// Enrolment numbers follow the `MS/<n>/<year>` hint from the court page. Test tooling only: not
// exported from the package entry. The seeded list and order generator is part 4 (#401).
import { mulberry32 } from '../../testing/synthetic.ts';

export const PETITIONERS = [
  'Fictional Mills Ltd.',
  'K. Imaginary Selvam',
  'Pretend Weavers Co-operative Society',
  'M. Kalpitha Devi',
  'Example Textiles Pvt. Ltd.',
  'R. Karpanai Murugan',
  'Made-up Traders',
  'S. Fictional Lakshmi',
] as const;

export const RESPONDENTS = [
  'The Secretary to Government (Fictional Department)',
  'The District Collector, Example District',
  'The Inspector of Police, Imaginary Nagar',
  'State rep. by the Public Prosecutor',
  'Pretend Municipal Corporation',
  'The Registrar, Fictional University',
] as const;

/** Advocates as lists print them, some with enrolment numbers. */
export const ADVOCATES = [
  'Mr. R. Fictional (MS/123/1990)',
  'Ms. A. Example',
  'Mr. K. Kalpitham (MS/4567/2004)',
  'Tmt. S. Imaginary',
  'Mr. P. Pretend, Govt. Advocate',
  'M/s Fictional & Example Associates',
  'Mr. V. Madeup, Addl. Public Prosecutor',
] as const;

export const JUDGES = [
  'THE HONOURABLE MR. JUSTICE A. FICTIONAL',
  'THE HONOURABLE MRS. JUSTICE B. EXAMPLE',
  'THE HONOURABLE MR. JUSTICE C. IMAGINARY',
  'THE HONOURABLE MS. JUSTICE D. PRETEND',
] as const;

export const CHIEF_JUSTICE = 'THE HONOURABLE THE CHIEF JUSTICE';

/** A seeded choice from `pool`. */
export function pick<T>(random: () => number, pool: readonly T[]): T {
  return pool[Math.floor(random() * pool.length)] as T;
}

export { mulberry32 };
