// Period arithmetic (days, weeks, months) for the deadline engine (#494). Month ends clamp
// (31 Jan + 1 month = 28/29 Feb); the arithmetic is the extraction's own so both agree.
import { addInterval, type RelativeUnit } from '@causedeck/intelligence';

export type PeriodUnit = RelativeUnit;

/** The end of `n` `unit`s counted from `from` (ISO), before any closure roll. */
export const addPeriod = (from: string, n: number, unit: PeriodUnit): string =>
  addInterval(from, n, unit);
