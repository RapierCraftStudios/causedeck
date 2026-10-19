// Plan logic (#28 part 1, #200; PRD PL-3, architecture §6.5). The catalogue data (kinds,
// intervals, statuses, price and budget constants, `PLAN_CATALOGUE`) lives in the leaf
// `@causedeck/validators/plans` (#297), so `@causedeck/db` need not depend on billing; it is
// re-exported here unchanged.
import {
  MIN_CHAMBER_SEATS,
  PLAN_CATALOGUE,
  UPI_AUTOPAY_MANDATE_CAP_PAISE,
  type Plan,
} from '@causedeck/validators/plans';

export {
  AI_BUDGET_PAISE_PER_SEAT,
  CLERK_SEAT_PRICE_PAISE,
  GST_RATE_BPS,
  JUNIOR_AI_BUDGET_PAISE,
  MIN_CHAMBER_SEATS,
  PLAN_CATALOGUE,
  PLAN_INTERVALS,
  PLAN_KINDS,
  SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
  UPI_AUTOPAY_MANDATE_CAP_PAISE,
} from '@causedeck/validators/plans';
export type {
  Plan,
  PlanInterval,
  PlanKind,
  PlanLimits,
  SubscriptionStatus,
} from '@causedeck/validators/plans';

export function getPlan(id: string, catalogue: readonly Plan[] = PLAN_CATALOGUE): Plan | undefined {
  return catalogue.find((p) => p.id === id);
}

/** True when one charge of `amountPaise` is above the UPI Autopay e-mandate cap. */
export function exceedsUpiMandateCap(amountPaise: number): boolean {
  return amountPaise > UPI_AUTOPAY_MANDATE_CAP_PAISE;
}

/**
 * The i18n key (`settings.json`, `.title` and `.body`, ICU arg `{amount}`) of the copy the mandate
 * flow shows when one charge needs additional authentication. The billing UI (#29) renders it.
 */
export const MANDATE_ADDITIONAL_AUTH_MESSAGE_KEY = 'billing.mandate.additionalAuth';

export interface MandateChargeNotice {
  /** One cycle's charge, integer paise, ex-GST. */
  chargePaise: number;
  /** The charge is above the UPI Autopay cap: show the additional-authentication copy. */
  requiresAdditionalAuth: boolean;
}

/**
 * The single-cycle charge for `plan` at these seat counts, and whether it needs the
 * additional-authentication copy in the mandate flow. Per-seat plans charge each paid seat plus
 * each clerk seat; fixed-price plans charge the plan price.
 */
export function mandateChargeNotice(
  plan: Pick<Plan, 'pricePaise' | 'perSeat' | 'clerkSeatPricePaise'>,
  counts: { seats: number; clerkSeats: number },
): MandateChargeNotice {
  const chargePaise = plan.perSeat
    ? plan.pricePaise * counts.seats + (plan.clerkSeatPricePaise ?? 0) * counts.clerkSeats
    : plan.pricePaise;
  return { chargePaise, requiresAdditionalAuth: exceedsUpiMandateCap(chargePaise) };
}

export type PlanConfigFindingCode =
  'invalid' | 'upi-mandate-cap-exceeded' | 'upi-mandate-cap-seats';

export interface PlanConfigFinding {
  planId: string;
  code: PlanConfigFindingCode;
  message: string;
  /** For `upi-mandate-cap-seats`: the most paid seats whose single charge stays within the cap. */
  maxSeatsWithinCap?: number;
}

const isPaise = (n: number | null): boolean => n === null || (Number.isSafeInteger(n) && n >= 0);

/**
 * Check the catalogue: integer non-negative paise, chamber minimum seats, unique ids, and the UPI
 * Autopay mandate cap. A fixed-price plan above the cap is flagged outright; a per-seat plan gets a
 * note with the seat count beyond which one charge needs additional authentication.
 */
export function checkPlanConfig(catalogue: readonly Plan[] = PLAN_CATALOGUE): PlanConfigFinding[] {
  const findings: PlanConfigFinding[] = [];
  const seen = new Set<string>();
  const cap = UPI_AUTOPAY_MANDATE_CAP_PAISE;

  for (const plan of catalogue) {
    const invalid = (message: string) =>
      findings.push({ planId: plan.id, code: 'invalid', message });
    if (seen.has(plan.id)) invalid(`duplicate plan id ${plan.id}`);
    seen.add(plan.id);
    if (!isPaise(plan.pricePaise) || !isPaise(plan.clerkSeatPricePaise)) {
      invalid(`${plan.id}: prices must be non-negative integer paise`);
      continue;
    }
    const { aiBudgetPaisePerMonth, aiBudgetPaisePerSeatPerMonth } = plan.limits.fairUse;
    if (!isPaise(aiBudgetPaisePerMonth) || !isPaise(aiBudgetPaisePerSeatPerMonth)) {
      invalid(`${plan.id}: AI budgets must be non-negative integer paise`);
      continue;
    }
    if (!Number.isSafeInteger(plan.minSeats) || plan.minSeats < 1) {
      invalid(`${plan.id}: minSeats must be a positive integer`);
      continue;
    }
    if (plan.perSeat && plan.minSeats < MIN_CHAMBER_SEATS) {
      invalid(`${plan.id}: per-seat plans need at least ${String(MIN_CHAMBER_SEATS)} seats`);
    }

    const minimumCharge = plan.perSeat ? plan.pricePaise * plan.minSeats : plan.pricePaise;
    if (exceedsUpiMandateCap(minimumCharge)) {
      findings.push({
        planId: plan.id,
        code: 'upi-mandate-cap-exceeded',
        message: `${plan.id}: a charge of ${String(minimumCharge)} paise exceeds the UPI Autopay mandate cap of ${String(cap)} paise; it needs additional authentication`,
      });
    } else if (plan.perSeat && plan.pricePaise > 0) {
      const maxSeatsWithinCap = Math.floor(cap / plan.pricePaise);
      findings.push({
        planId: plan.id,
        code: 'upi-mandate-cap-seats',
        maxSeatsWithinCap,
        message: `${plan.id}: more than ${String(maxSeatsWithinCap)} seats (seat and clerk-seat charges together above ${String(cap)} paise) exceeds the UPI Autopay mandate cap; such charges need additional authentication`,
      });
    }
  }
  return findings;
}
