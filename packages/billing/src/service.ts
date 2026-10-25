// Billing service (#28 part 3, #202): subscription operations on top of a `BillingProvider`. It
// never touches the database (`@causedeck/db` depends on this package): every operation takes a
// `SubscriptionSnapshot` and returns the next one, which the caller persists. Legality is checked
// by the state machine before any provider call, so an illegal request has no side effects.
//
// Seats: an increase is applied now and the prorated difference is returned as `charge` (collected
// by invoicing, #29); a decrease is scheduled at the provider for the next cycle and recorded as
// `pendingSeats`, applied on the next `charged`. The provider quantity is the paid-seat count.
//
// Plan changes (#257), between plans of the same interval: moving to a dearer cycle charge applies
// now and charges the prorated difference for the rest of the period; a cheaper one is scheduled at
// the provider for the period end and never refunded (as with seat decreases). `quoteChange` is
// the pure summary the owner confirms before either change.
import { gstOn } from './gst/calc';
import { getPlan, mandateChargeNotice, PLAN_CATALOGUE, type Plan } from './plans';
import { prorateSeatIncrease, roundHalfUpDiv, type ProrationResult } from './proration';
import type { BillingProvider, BillingSubscription } from './provider/types';
import {
  transition,
  type SeatCounts,
  type SubscriptionEvent,
  type SubscriptionSnapshot,
} from './state-machine';

export { applyProviderEvent } from './state-machine';

export type BillingServiceErrorCode = 'INVALID_INPUT';

export class BillingServiceError extends Error {
  readonly code: BillingServiceErrorCode;

  constructor(code: BillingServiceErrorCode, message: string) {
    super(message);
    this.name = 'BillingServiceError';
    this.code = code;
  }
}

export interface BillingServiceOptions {
  provider: BillingProvider;
  now?: () => Date;
  catalogue?: readonly Plan[];
  /** The provider's plan id for a catalogue plan (Razorpay `plan_…`). Defaults to the catalogue id. */
  providerPlanId?: (plan: Plan) => string;
}

export interface StartSubscriptionInput {
  planId: string;
  seats: number;
  clerkSeats?: number;
  billingEmail: string;
  customerName?: string;
  notes?: Record<string, string>;
}

export interface BillingOperationResult {
  subscription: SubscriptionSnapshot;
  charge: ProrationResult | null;
  provider: BillingSubscription;
}

export interface StartSubscriptionResult extends BillingOperationResult {
  mandateUrl: string;
}

export interface ChangePlanInput extends SeatCounts {
  planId: string;
}

export interface BillingService {
  startSubscription(input: StartSubscriptionInput): Promise<StartSubscriptionResult>;
  changeSeats(snapshot: SubscriptionSnapshot, seats: SeatCounts): Promise<BillingOperationResult>;
  /** Move to another plan of the same interval: dearer now, cheaper at period end (#257). */
  changePlan(
    snapshot: SubscriptionSnapshot,
    input: ChangePlanInput,
  ): Promise<BillingOperationResult>;
  cancel(
    snapshot: SubscriptionSnapshot,
    options: { atPeriodEnd: boolean },
  ): Promise<BillingOperationResult>;
  resume(snapshot: SubscriptionSnapshot): Promise<BillingOperationResult>;
  /** Keep a subscription that was set to cancel at period end (#257). */
  withdrawCancellation(snapshot: SubscriptionSnapshot): Promise<BillingOperationResult>;
}

/** Seat counts, plus the tracked cases a per-tracked-case plan (#664) is billed on. */
export type ChargeCounts = SeatCounts & { trackedCases?: number };

/** One cycle's charge for `plan` at these seat counts, integer paise, ex-GST. */
export function cycleChargePaise(
  plan: Pick<Plan, 'pricePaise' | 'perSeat' | 'clerkSeatPricePaise' | 'perTrackedCase'>,
  counts: ChargeCounts,
): number {
  return mandateChargeNotice(plan, counts).chargePaise;
}

/** The prorated difference for moving from one cycle charge to a dearer one at `at`. */
export function proratePlanChange(input: {
  fromChargePaise: number;
  toChargePaise: number;
  periodStart: Date;
  periodEnd: Date;
  at: Date;
}): ProrationResult {
  const start = input.periodStart.getTime();
  const end = input.periodEnd.getTime();
  if (!(end > start)) throw new RangeError('periodEnd must be after periodStart');
  const periodSeconds = Math.floor((end - start) / 1000);
  const remainingSeconds = Math.min(
    Math.max(Math.floor((end - input.at.getTime()) / 1000), 0),
    periodSeconds,
  );
  const difference = Math.max(0, input.toChargePaise - input.fromChargePaise);
  const amountPaise = Number(
    roundHalfUpDiv(
      BigInt(difference) * BigInt(remainingSeconds),
      BigInt(Math.max(periodSeconds, 1)),
    ),
  );
  // One amount for the whole plan change, so no per-seat lines.
  return { amountPaise, lines: [], remainingSeconds, periodSeconds };
}

export interface QuoteChangeInput {
  current: { plan: Plan; counts: ChargeCounts };
  target: { plan: Plan; counts: ChargeCounts };
  periodStart: Date | null;
  periodEnd: Date | null;
  at: Date;
}

/** What the owner confirms before a plan or seat change. Integer paise; GST at 18% (`gstOn`). */
export interface ChangeQuote {
  /** One cycle's charge after the change, ex-GST, its GST and the GST-inclusive total. */
  basePaise: number;
  gstPaise: number;
  totalPaise: number;
  /** Charged now for the rest of the current period (0 when nothing is due now). */
  prorationPaise: number;
  prorationGstPaise: number;
  prorationTotalPaise: number;
  /** `now` for an upgrade or seat increase; `period_end` for a downgrade or seat decrease. */
  effective: 'now' | 'period_end';
  /** When the change takes effect: `at`, or the end of the current period. */
  effectiveDate: Date;
}

/** The pre-confirmation summary for changing plan and/or seats (pure). */
export function quoteChange(input: QuoteChangeInput): ChangeQuote {
  const { current, target, periodStart, periodEnd, at } = input;
  const basePaise = cycleChargePaise(target.plan, target.counts);
  const fromChargePaise = cycleChargePaise(current.plan, current.counts);
  const planChanged = current.plan.id !== target.plan.id;
  const increased =
    target.counts.seats > current.counts.seats ||
    target.counts.clerkSeats > current.counts.clerkSeats;
  const upgrade = basePaise > fromChargePaise;
  const effective = (planChanged ? upgrade : increased) ? 'now' : 'period_end';
  let prorationPaise = 0;
  if (effective === 'now' && periodStart && periodEnd && at >= periodStart && at <= periodEnd) {
    if (planChanged) {
      prorationPaise = proratePlanChange({
        fromChargePaise,
        toChargePaise: basePaise,
        periodStart,
        periodEnd,
        at,
      }).amountPaise;
    } else if (increased) {
      prorationPaise = prorateSeatIncrease({
        plan: target.plan,
        from: current.counts,
        to: {
          seats: Math.max(current.counts.seats, target.counts.seats),
          clerkSeats: Math.max(current.counts.clerkSeats, target.counts.clerkSeats),
        },
        periodStart,
        periodEnd,
        at,
      }).amountPaise;
    }
  }
  const gstPaise = gstOn(basePaise);
  const prorationGstPaise = gstOn(prorationPaise);
  return {
    basePaise,
    gstPaise,
    totalPaise: basePaise + gstPaise,
    prorationPaise,
    prorationGstPaise,
    prorationTotalPaise: prorationPaise + prorationGstPaise,
    effective,
    effectiveDate: effective === 'now' || periodEnd === null ? at : periodEnd,
  };
}

export function createBillingService(options: BillingServiceOptions): BillingService {
  const { provider } = options;
  const now = options.now ?? (() => new Date());
  const catalogue = options.catalogue ?? PLAN_CATALOGUE;
  const providerPlanId = options.providerPlanId ?? ((plan: Plan) => plan.id);

  const invalid = (message: string) => new BillingServiceError('INVALID_INPUT', message);

  function paidPlan(planId: string): Plan {
    const plan = getPlan(planId, catalogue);
    if (!plan?.active) throw invalid(`Unknown or inactive plan ${planId}`);
    if (plan.kind === 'junior' || plan.pricePaise === 0) {
      throw invalid(`${planId} is free and has no subscription`);
    }
    return plan;
  }

  function assertSeats(plan: Plan, counts: SeatCounts): void {
    if (!Number.isSafeInteger(counts.seats) || counts.seats < plan.minSeats) {
      throw invalid(`${plan.id} needs at least ${String(plan.minSeats)} seats`);
    }
    if (!Number.isSafeInteger(counts.clerkSeats) || counts.clerkSeats < 0) {
      throw invalid('clerkSeats must be a non-negative integer');
    }
    if (counts.clerkSeats > 0 && plan.clerkSeatPricePaise === null) {
      throw invalid(`${plan.id} has no clerk seats`);
    }
  }

  function providerId(snapshot: SubscriptionSnapshot): string {
    if (snapshot.providerSubscriptionId === null) {
      throw invalid('the subscription has no provider subscription id');
    }
    return snapshot.providerSubscriptionId;
  }

  function apply(snapshot: SubscriptionSnapshot, events: SubscriptionEvent[], at: Date) {
    return events.reduce((s, event) => transition(s, event, at), snapshot);
  }

  return {
    async startSubscription(input) {
      const plan = paidPlan(input.planId);
      const counts = { seats: input.seats, clerkSeats: input.clerkSeats ?? 0 };
      assertSeats(plan, counts);
      const customer = await provider.createCustomer({
        email: input.billingEmail,
        ...(input.customerName === undefined ? {} : { name: input.customerName }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      });
      const created = await provider.createSubscription({
        customerId: customer.id,
        planId: providerPlanId(plan),
        quantity: counts.seats,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      });
      const link = await provider.createMandateLink(created.id);
      const subscription: SubscriptionSnapshot = Object.freeze({
        state: 'created',
        planId: plan.id,
        seats: counts.seats,
        clerkSeats: counts.clerkSeats,
        currentPeriodStart: created.currentStart,
        currentPeriodEnd: created.currentEnd,
        graceUntil: null,
        cancelAtPeriodEnd: false,
        pendingSeats: null,
        providerSubscriptionId: created.id,
        providerCustomerId: customer.id,
      });
      return { subscription, charge: null, provider: created, mandateUrl: link.url };
    },

    async changeSeats(snapshot, target) {
      const plan = paidPlan(snapshot.planId);
      assertSeats(plan, target);
      const id = providerId(snapshot);
      const at = now();
      const current = { seats: snapshot.seats, clerkSeats: snapshot.clerkSeats };
      // Increases apply now; decreases (including the falling half of a mixed change) wait.
      const immediate = {
        seats: Math.max(current.seats, target.seats),
        clerkSeats: Math.max(current.clerkSeats, target.clerkSeats),
      };
      const events: SubscriptionEvent[] = [];
      if (immediate.seats !== current.seats || immediate.clerkSeats !== current.clerkSeats) {
        events.push({ type: 'seats_changed', effective: 'now', ...immediate });
      }
      if (immediate.seats !== target.seats || immediate.clerkSeats !== target.clerkSeats) {
        events.push({ type: 'seats_changed', effective: 'period_end', ...target });
      }
      if (events.length === 0) throw invalid('the seat counts are unchanged');
      // Validate the whole change before touching the provider.
      const subscription = apply(snapshot, events, at);

      let result: BillingSubscription | null = null;
      if (immediate.seats !== current.seats) {
        result = await provider.updateSubscriptionQuantity(id, immediate.seats, { at: 'now' });
      }
      if (target.seats !== immediate.seats) {
        result = await provider.updateSubscriptionQuantity(id, target.seats, { at: 'cycle_end' });
      }
      result ??= await provider.fetchSubscription(id);

      const increased = events[0]?.type === 'seats_changed' && events[0].effective === 'now';
      const charge =
        increased && snapshot.currentPeriodStart && snapshot.currentPeriodEnd
          ? prorateSeatIncrease({
              plan,
              from: current,
              to: immediate,
              periodStart: snapshot.currentPeriodStart,
              periodEnd: snapshot.currentPeriodEnd,
              at,
            })
          : null;
      return { subscription, charge, provider: result };
    },

    async changePlan(snapshot, input) {
      const target = paidPlan(input.planId);
      const counts = { seats: input.seats, clerkSeats: input.clerkSeats };
      assertSeats(target, counts);
      if (target.id === snapshot.planId) throw invalid(`already on ${target.id}`);
      const current = getPlan(snapshot.planId, catalogue);
      if (current && current.interval !== target.interval) {
        throw invalid('switch between monthly and annual billing at renewal');
      }
      const id = providerId(snapshot);
      const at = now();
      const from = current
        ? cycleChargePaise(current, { seats: snapshot.seats, clerkSeats: snapshot.clerkSeats })
        : 0;
      const to = cycleChargePaise(target, counts);
      if (to <= from) {
        // A downgrade: scheduled at the provider for the period end, nothing refunded. The plan
        // column keeps the current plan until then. The transition still validates the state.
        apply(snapshot, [{ type: 'plan_changed', planId: target.id }], at);
        const subscription =
          counts.seats === snapshot.seats && counts.clerkSeats === snapshot.clerkSeats
            ? snapshot
            : apply(snapshot, [{ type: 'seats_changed', effective: 'period_end', ...counts }], at);
        const result = await provider.updateSubscriptionPlan(id, {
          planId: providerPlanId(target),
          quantity: counts.seats,
          at: 'cycle_end',
        });
        return { subscription, charge: null, provider: result };
      }
      // Validate the whole change before touching the provider.
      const subscription = apply(
        snapshot,
        [
          { type: 'plan_changed', planId: target.id },
          { type: 'seats_changed', effective: 'now', ...counts },
        ],
        at,
      );
      const result = await provider.updateSubscriptionPlan(id, {
        planId: providerPlanId(target),
        quantity: counts.seats,
        at: 'now',
      });
      const charge =
        snapshot.currentPeriodStart && snapshot.currentPeriodEnd
          ? proratePlanChange({
              fromChargePaise: from,
              toChargePaise: to,
              periodStart: snapshot.currentPeriodStart,
              periodEnd: snapshot.currentPeriodEnd,
              at,
            })
          : null;
      return { subscription, charge, provider: result };
    },

    async cancel(snapshot, cancelOptions) {
      const id = providerId(snapshot);
      const subscription = transition(
        snapshot,
        { type: 'cancel_requested', atPeriodEnd: cancelOptions.atPeriodEnd },
        now(),
      );
      const result = await provider.cancelSubscription(id, {
        atCycleEnd: cancelOptions.atPeriodEnd,
      });
      return { subscription, charge: null, provider: result };
    },

    async resume(snapshot) {
      const id = providerId(snapshot);
      // Only a paused subscription resumes; Razorpay cannot withdraw a scheduled cancellation.
      const subscription = transition(snapshot, { type: 'resumed' }, now());
      const result = await provider.resume(id);
      return { subscription, charge: null, provider: result };
    },

    async withdrawCancellation(snapshot) {
      const id = providerId(snapshot);
      if (!snapshot.cancelAtPeriodEnd) throw invalid('the subscription is not set to cancel');
      const subscription = transition(snapshot, { type: 'cancel_withdrawn' }, now());
      const result = await provider.withdrawCancellation(id);
      return { subscription, charge: null, provider: result };
    },
  };
}
