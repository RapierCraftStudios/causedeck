// Plan catalogue (#28 part 1, #200; PRD PL-3, architecture §6.5). Prices are data: change a row
// here (and re-run the `plans` seeder) to change a price, never code. Every amount is integer paise
// and ex-GST; 18% GST is added at invoice time (#29).
//
// The rupee amounts are test prices to validate pricing (Rs 499 → 49_900 paise). Annual plans are
// about two months free, so 10 × the monthly price.
//
// This module imports no other workspace (#297): `@causedeck/db` imports it for the `plan` table
// checks and the seed, and `@causedeck/billing/plans` re-exports it next to the plan logic.

export const PLAN_KINDS = ['junior', 'advocate', 'chamber', 'dedicated'] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_INTERVALS = ['month', 'year'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses after which a workspace may start a new subscription. */
export const TERMINAL_SUBSCRIPTION_STATUSES = ['cancelled', 'expired'] as const;

/** Chamber plans are sold per seat with at least this many seats. */
export const MIN_CHAMBER_SEATS = 3;

/** A clerk seat on a chamber plan, per month, ex-GST. */
export const CLERK_SEAT_PRICE_PAISE = 19_900;

/**
 * UPI Autopay e-mandates debit up to Rs 15,000 per charge without per-charge authentication
 * (architecture §6.5 [R]). A larger charge needs additional authentication, so the config check
 * flags it.
 */
export const UPI_AUTOPAY_MANDATE_CAP_PAISE = 1_500_000;

/** Prices are ex-GST; #29 applies GST at this rate (basis points) on the invoice. */
export const GST_RATE_BPS = 1_800;

/** The free plan's monthly AI budget (#30, #220; PRD NFR Cost: <= Rs 10 per free workspace). */
export const JUNIOR_AI_BUDGET_PAISE = 1_000;

/**
 * A paid plan's monthly AI budget per seat (#30, #220; PRD NFR Cost: <= Rs 175 per active seat),
 * pooled at the workspace level across `entitlements.seats`.
 */
export const AI_BUDGET_PAISE_PER_SEAT = 17_500;

/** Usage limits a plan grants. `null` means unlimited. Entitlements (#203) derive from these. */
export interface PlanLimits {
  maxActiveMatters: number | null;
  /**
   * Fair-use caps, enforced by `assertWithinFairUse` (#221, `@causedeck/core/usage`). The Junior
   * values are tunable placeholders, as plain data.
   */
  fairUse: {
    /** Hearing-capture transcription (STT) minutes per IST month. */
    captureMinutesPerMonth: number | null;
    /** OCR pages per IST month. */
    ocrPagesPerMonth: number | null;
    /** A flat monthly AI budget for the workspace; used when there is no per-seat budget. */
    aiBudgetPaisePerMonth: number | null;
    /** A monthly AI budget per seat, pooled across the workspace's seats; wins when set. */
    aiBudgetPaisePerSeatPerMonth: number | null;
  };
}

/** One catalogue row. The fields other than `limits` are the `plan` table's columns. */
export interface Plan {
  id: string;
  name: string;
  kind: PlanKind;
  interval: PlanInterval;
  /** Per charge, or per seat when `perSeat`. Integer paise, ex-GST. */
  pricePaise: number;
  perSeat: boolean;
  clerkSeatPricePaise: number | null;
  minSeats: number;
  active: boolean;
  limits: PlanLimits;
}

/** Paid plans: unlimited matters and capture, AI budget pooled per seat. */
const PAID: PlanLimits = {
  maxActiveMatters: null,
  fairUse: {
    captureMinutesPerMonth: null,
    ocrPagesPerMonth: null,
    aiBudgetPaisePerMonth: null,
    aiBudgetPaisePerSeatPerMonth: AI_BUDGET_PAISE_PER_SEAT,
  },
};

const ADVOCATE_TIERS = [49_900, 79_900, 119_900] as const;
const CHAMBER_SEAT_BANDS = [49_900, 64_900, 89_900] as const;
const ANNUAL_MONTHS = 10;

function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export const PLAN_CATALOGUE: readonly Readonly<Plan>[] = Object.freeze([
  freeze<Plan>({
    id: 'junior',
    name: 'Junior',
    kind: 'junior',
    interval: 'month',
    pricePaise: 0,
    perSeat: false,
    clerkSeatPricePaise: null,
    minSeats: 1,
    active: true,
    limits: {
      maxActiveMatters: 15,
      fairUse: {
        captureMinutesPerMonth: 300,
        ocrPagesPerMonth: 200,
        aiBudgetPaisePerMonth: JUNIOR_AI_BUDGET_PAISE,
        aiBudgetPaisePerSeatPerMonth: null,
      },
    },
  }),
  ...ADVOCATE_TIERS.map((pricePaise, i) =>
    freeze<Plan>({
      id: `advocate-monthly-${String(i + 1)}`,
      name: `Advocate ${String(i + 1)} (monthly)`,
      kind: 'advocate',
      interval: 'month',
      pricePaise,
      perSeat: false,
      clerkSeatPricePaise: null,
      minSeats: 1,
      active: true,
      limits: PAID,
    }),
  ),
  ...ADVOCATE_TIERS.map((monthly, i) =>
    freeze<Plan>({
      id: `advocate-annual-${String(i + 1)}`,
      name: `Advocate ${String(i + 1)} (annual)`,
      kind: 'advocate',
      interval: 'year',
      pricePaise: monthly * ANNUAL_MONTHS,
      perSeat: false,
      clerkSeatPricePaise: null,
      minSeats: 1,
      active: true,
      limits: PAID,
    }),
  ),
  ...CHAMBER_SEAT_BANDS.map((pricePaise, i) =>
    freeze<Plan>({
      id: `chamber-seat-${String(i + 1)}`,
      name: `Chamber ${String(i + 1)} (per seat, monthly)`,
      kind: 'chamber',
      interval: 'month',
      pricePaise,
      perSeat: true,
      clerkSeatPricePaise: CLERK_SEAT_PRICE_PAISE,
      minSeats: MIN_CHAMBER_SEATS,
      active: true,
      limits: PAID,
    }),
  ),
]);
