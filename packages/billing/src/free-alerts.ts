// The free court-day alerts tier (#506, growth: the acquisition hook). It is not a new plan: the
// free Junior plan already exists, so this is the alerts allowance that plan carries, as data like
// the rest of the catalogue. A paid plan has no entry and is not capped here. Fetch cost is counted
// in millionths of a US dollar (`fetch.cost_micros`, integer), the unit the fetch layer's
// per-fetch `costDollars` converts to, so a cap is exact integer arithmetic.
import { getPlan } from './plans';

/** What a free advocate's alerts may use. */
export interface FreeAlertsLimits {
  /** Case-status watches the free tier sets up on its own (discovery enrols up to this many). */
  maxWatches: number;
  /** Monthly (IST) fetch spend for the workspace's delegated lookups, in micro-dollars. */
  fetchCostCapMicrosPerMonth: number;
  /**
   * The most one lookup is assumed to cost, in micro-dollars. A lookup is admitted only when the
   * month's spend plus this still fits the cap, so spend never passes the cap by more than a
   * lookup that cost more than this.
   */
  fetchCostCeilingMicros: number;
  /** What a lookup counts for at least, in micro-dollars, even when the tier fetched it for free. */
  fetchCostFloorMicros: number;
}

/** Tunable placeholders (a founder pricing call); about Rs 40 of fetch per free user a month, at most. */
export const FREE_ALERTS_LIMITS: Readonly<FreeAlertsLimits> = Object.freeze({
  maxWatches: 10,
  fetchCostCapMicrosPerMonth: 500_000,
  fetchCostCeilingMicros: 50_000,
  fetchCostFloorMicros: 1_000,
});

/** Plans that carry the free alerts allowance, by plan id. */
export const FREE_ALERTS_PLAN_LIMITS: Readonly<Record<string, Readonly<FreeAlertsLimits>>> =
  Object.freeze({ junior: FREE_ALERTS_LIMITS });

/** The allowance of `planId`, or `null` when the plan is not free (paid plans are not capped here). */
export function freeAlertsLimitsFor(
  planId: string,
  table: Readonly<Record<string, Readonly<FreeAlertsLimits>>> = FREE_ALERTS_PLAN_LIMITS,
): Readonly<FreeAlertsLimits> | null {
  const limits = table[planId];
  if (limits === undefined) return null;
  const plan = getPlan(planId);
  return plan !== undefined && plan.pricePaise > 0 ? null : limits;
}

/** A fetch's cost in whole micro-dollars (rounded up), never below the tier's floor. */
export function fetchCostMicros(costDollars: number, floorMicros = 0): number {
  if (!Number.isFinite(costDollars) || costDollars < 0) {
    throw new RangeError('costDollars must be a non-negative number');
  }
  return Math.max(Math.ceil(costDollars * 1_000_000 - 1e-9), floorMicros);
}
