// Billing service (#28 part 3, #202): subscription operations on top of a `BillingProvider`. It
// never touches the database (`@causedeck/db` depends on this package): every operation takes a
// `SubscriptionSnapshot` and returns the next one, which the caller persists. Legality is checked
// by the state machine before any provider call, so an illegal request has no side effects.
//
// Seats: an increase is applied now and the prorated difference is returned as `charge` (collected
// by invoicing, #29); a decrease is scheduled at the provider for the next cycle and recorded as
// `pendingSeats`, applied on the next `charged`. The provider quantity is the paid-seat count.
import { getPlan, PLAN_CATALOGUE, type Plan } from './plans';
import { prorateSeatIncrease, type ProrationResult } from './proration';
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

export interface BillingService {
  startSubscription(input: StartSubscriptionInput): Promise<StartSubscriptionResult>;
  changeSeats(snapshot: SubscriptionSnapshot, seats: SeatCounts): Promise<BillingOperationResult>;
  cancel(
    snapshot: SubscriptionSnapshot,
    options: { atPeriodEnd: boolean },
  ): Promise<BillingOperationResult>;
  resume(snapshot: SubscriptionSnapshot): Promise<BillingOperationResult>;
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
  };
}
