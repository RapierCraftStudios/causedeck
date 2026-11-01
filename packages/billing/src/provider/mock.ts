// Deterministic in-memory billing provider for dev, CI and tests (#201). No network, no
// credentials and no randomness: ids come from per-prefix counters and time from an injectable
// clock, so the same calls on two fresh instances return deep-equal results. It stays in memory
// because `@causedeck/db` depends on this package (a DB-backed mock would be a cycle).
//
// Beyond `BillingProvider` it can drive the UPI Autopay mandate (`authorizeMandate`,
// `setMandateState`) and raise provider events (`simulate`), returning the same webhook body
// Razorpay would send (see `src/__fixtures__/razorpay/`). `adoptSubscription` registers a
// subscription that exists only in the database (the e2e seed), so a long-lived mock can act on it.
import { getPlan, type PlanInterval } from '../plans';
import { MOCK_WEBHOOK_SECRET, signRazorpayWebhook } from '../webhook';
import {
  BillingProviderError,
  type BillingCustomer,
  type BillingProvider,
  type BillingSubscription,
  type CancelOptions,
  type CreateCustomerInput,
  type CreateSubscriptionInput,
  type MandateLink,
  type MandateState,
  type PaymentRetryOutcome,
  type ProviderSubscriptionStatus,
  type RazorpayPaymentEntity,
  type RazorpaySubscriptionEntity,
  type RazorpayWebhookEvent,
  type SimulatedEvent,
  type UpdatePlanInput,
} from './types';

/** Default clock: a fixed instant, so snapshots never depend on the wall clock. */
export const MOCK_EPOCH = new Date('2026-01-01T00:00:00.000Z');

export const MOCK_ACCOUNT_ID = 'acc_mock_0001';

/** Host of the mock hosted-authorisation pages; never resolved. */
export const MOCK_MANDATE_BASE_URL = 'https://mock.razorpay.local/mandate/';

const DEFAULT_TOTAL_COUNT = 120;

/** One webhook delivery: Razorpay sends the event id in the `x-razorpay-event-id` header. */
export interface MockWebhookDelivery {
  eventId: string;
  body: RazorpayWebhookEvent;
}

/** A delivery as it goes over the wire: the exact body bytes and their signature (#204). */
export interface SignedMockDelivery {
  eventId: string;
  rawBody: string;
  signature: string;
}

/** Serialise and sign a mock delivery with `MOCK_WEBHOOK_SECRET`, as Razorpay would send it. */
export function signMockDelivery(delivery: MockWebhookDelivery): SignedMockDelivery {
  const rawBody = JSON.stringify(delivery.body);
  return {
    eventId: delivery.eventId,
    rawBody,
    signature: signRazorpayWebhook(rawBody, MOCK_WEBHOOK_SECRET),
  };
}

/** A subscription known to the caller (a database row) but not yet to this mock instance. */
export interface AdoptSubscriptionInput {
  id: string;
  customerId: string | null;
  planId: string;
  quantity: number;
  status: ProviderSubscriptionStatus;
  currentStart: Date | null;
  currentEnd: Date | null;
  cancelAtCycleEnd: boolean;
}

export interface MockBillingProviderOptions {
  now?: () => Date;
}

export interface MockBillingProvider extends BillingProvider {
  readonly name: 'mock';
  /**
   * Register `input` unless the id is already known (then a no-op). Returns the subscription as
   * this mock now sees it.
   */
  adoptSubscription(input: AdoptSubscriptionInput): Promise<BillingSubscription>;
  /** The customer completes the UPI Autopay authorisation: first charge, subscription active. */
  authorizeMandate(subscriptionId: string): Promise<RazorpayWebhookEvent>;
  /**
   * The payer finishes the mandate restarted by `updatePaymentMethod`: the mandate is active, a
   * `created` subscription is activated and a `pending` or `halted` one is charged (the `subscription.charged` webhook body). `null`
   * when no charge was due.
   */
  confirmPaymentMethod(subscriptionId: string): Promise<RazorpayWebhookEvent | null>;
  /** Force a mandate state (for example `failed` or `cancelled` from the payer's UPI app). */
  setMandateState(subscriptionId: string, state: MandateState): Promise<BillingSubscription>;
  /** Raise a provider event, apply it and return the webhook body Razorpay would send. */
  simulate(subscriptionId: string, event: SimulatedEvent): Promise<RazorpayWebhookEvent>;
  /** Whether the next `retryPayment` calls for this subscription succeed (default `failed`). */
  setRetryOutcome(
    subscriptionId: string,
    outcome: Exclude<PaymentRetryOutcome, 'provider_scheduled'>,
  ): void;
  /** Every webhook raised so far, oldest first. */
  deliveries(): readonly MockWebhookDelivery[];
}

interface CustomerRecord {
  id: string;
  email: string;
  name: string | null;
  contact: string;
}

interface SubscriptionRecord {
  entity: RazorpaySubscriptionEntity;
  interval: PlanInterval;
  cancelAtCycleEnd: boolean;
  mandate: MandateState;
  /** Quantity scheduled for the next cycle by `updateSubscriptionQuantity(…, { at: 'cycle_end' })`. */
  pendingQuantity: number | null;
  /** Plan scheduled for the next cycle by `updateSubscriptionPlan(…, { at: 'cycle_end' })`. */
  pendingPlanId: string | null;
  /** What `retryPayment` does: charge, or fail again. */
  retryOutcome: 'charged' | 'failed';
}

/** Event name → statuses it may fire from. */
const EVENT_FROM: Record<SimulatedEvent, readonly ProviderSubscriptionStatus[]> = {
  'subscription.charged': ['authenticated', 'active', 'pending', 'halted'],
  'payment.failed': ['active', 'pending'],
  'subscription.halted': ['active', 'pending'],
  'subscription.cancelled': ['created', 'authenticated', 'active', 'pending', 'halted', 'paused'],
};

export function createMockBillingProvider(
  options: MockBillingProviderOptions = {},
): MockBillingProvider {
  const now = options.now ?? (() => MOCK_EPOCH);
  const counters = new Map<string, number>();
  const customers = new Map<string, CustomerRecord>();
  const subscriptions = new Map<string, SubscriptionRecord>();
  const log: MockWebhookDelivery[] = [];

  function nextId(prefix: string): string {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_mock_${String(n).padStart(4, '0')}`;
  }

  function seconds(): number {
    return Math.floor(now().getTime() / 1000);
  }

  function record(subscriptionId: string): SubscriptionRecord {
    const found = subscriptions.get(subscriptionId);
    if (!found) {
      throw new BillingProviderError('not_found', `Unknown subscription ${subscriptionId}`);
    }
    return found;
  }

  function assertStatus(
    rec: SubscriptionRecord,
    allowed: readonly ProviderSubscriptionStatus[],
    action: string,
  ): void {
    if (!allowed.includes(rec.entity.status)) {
      throw new BillingProviderError(
        'invalid_state',
        `Cannot ${action} subscription ${rec.entity.id} in status ${rec.entity.status}`,
      );
    }
  }

  function assertQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BillingProviderError('invalid_input', 'quantity must be a positive integer');
    }
  }

  /** Start a new billing period at `from` and schedule the next charge at its end. */
  function startPeriod(rec: SubscriptionRecord, from: number): void {
    if (rec.pendingQuantity !== null) {
      rec.entity.quantity = rec.pendingQuantity;
      rec.pendingQuantity = null;
      rec.entity.has_scheduled_changes = false;
      rec.entity.change_scheduled_at = null;
    }
    if (rec.pendingPlanId !== null) {
      rec.entity.plan_id = rec.pendingPlanId;
      rec.interval = getPlan(rec.pendingPlanId)?.interval ?? rec.interval;
      rec.pendingPlanId = null;
      rec.entity.has_scheduled_changes = false;
      rec.entity.change_scheduled_at = null;
    }
    const end = addInterval(from, rec.interval);
    rec.entity.current_start = from;
    rec.entity.current_end = end;
    rec.entity.charge_at = end;
    rec.entity.paid_count += 1;
    rec.entity.remaining_count = Math.max(0, rec.entity.total_count - rec.entity.paid_count);
  }

  function payment(rec: SubscriptionRecord, status: 'captured' | 'failed'): RazorpayPaymentEntity {
    const customer = rec.entity.customer_id ? customers.get(rec.entity.customer_id) : undefined;
    const plan = getPlan(rec.entity.plan_id);
    return {
      id: nextId('pay'),
      entity: 'payment',
      amount: (plan?.pricePaise ?? 0) * rec.entity.quantity,
      currency: 'INR',
      status,
      order_id: null,
      invoice_id: null,
      method: 'upi',
      description: `Subscription ${rec.entity.id}`,
      customer_id: rec.entity.customer_id,
      email: customer?.email ?? '',
      contact: customer?.contact ?? '',
      error_code: status === 'failed' ? 'BAD_REQUEST_ERROR' : null,
      error_description:
        status === 'failed' ? 'Payment failed: the UPI Autopay debit was declined.' : null,
      created_at: seconds(),
    };
  }

  function emit(
    rec: SubscriptionRecord,
    event: string,
    paymentEntity?: RazorpayPaymentEntity,
  ): RazorpayWebhookEvent {
    const body: RazorpayWebhookEvent = {
      entity: 'event',
      account_id: MOCK_ACCOUNT_ID,
      event,
      contains: paymentEntity ? ['subscription', 'payment'] : ['subscription'],
      payload: {
        subscription: { entity: structuredClone(rec.entity) },
        ...(paymentEntity ? { payment: { entity: paymentEntity } } : {}),
      },
      created_at: seconds(),
    };
    log.push({ eventId: nextId('evt'), body });
    return structuredClone(body);
  }

  function view(rec: SubscriptionRecord): BillingSubscription {
    const e = rec.entity;
    return {
      id: e.id,
      customerId: e.customer_id,
      planId: e.plan_id,
      status: e.status,
      quantity: e.quantity,
      currentStart: toDate(e.current_start),
      currentEnd: toDate(e.current_end),
      chargeAt: toDate(e.charge_at),
      cancelAtCycleEnd: rec.cancelAtCycleEnd,
      shortUrl: e.short_url,
      mandate: { method: 'upi', state: rec.mandate },
      pendingQuantity: rec.pendingQuantity,
    };
  }

  const provider: MockBillingProvider = {
    name: 'mock',

    createCustomer(input: CreateCustomerInput): Promise<BillingCustomer> {
      return attempt(() => {
        if (!input.email.includes('@')) {
          throw new BillingProviderError('invalid_input', 'email is invalid');
        }
        const customer: CustomerRecord = {
          id: nextId('cust'),
          email: input.email,
          name: input.name ?? null,
          contact: input.contact ?? '',
        };
        customers.set(customer.id, customer);
        return { id: customer.id, email: customer.email, name: customer.name };
      });
    },

    createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription> {
      return attempt(() => {
        if (!customers.has(input.customerId)) {
          throw new BillingProviderError('not_found', `Unknown customer ${input.customerId}`);
        }
        assertQuantity(input.quantity);
        const id = nextId('sub');
        const totalCount = input.totalCount ?? DEFAULT_TOTAL_COUNT;
        const createdAt = seconds();
        const startAt = input.startAt ? Math.floor(input.startAt.getTime() / 1000) : null;
        const rec: SubscriptionRecord = {
          interval: getPlan(input.planId)?.interval ?? 'month',
          cancelAtCycleEnd: false,
          mandate: 'created',
          pendingQuantity: null,
          pendingPlanId: null,
          retryOutcome: 'failed',
          entity: {
            id,
            entity: 'subscription',
            plan_id: input.planId,
            customer_id: input.customerId,
            status: 'created',
            current_start: null,
            current_end: null,
            ended_at: null,
            quantity: input.quantity,
            notes: input.notes ? { ...input.notes } : [],
            charge_at: startAt,
            start_at: startAt,
            end_at: null,
            auth_attempts: 0,
            total_count: totalCount,
            paid_count: 0,
            customer_notify: true,
            created_at: createdAt,
            expire_by: null,
            short_url: `${MOCK_MANDATE_BASE_URL}${id}`,
            has_scheduled_changes: false,
            change_scheduled_at: null,
            source: 'api',
            payment_method: 'upi',
            offer_id: null,
            remaining_count: totalCount,
          },
        };
        subscriptions.set(id, rec);
        return view(rec);
      });
    },

    updateSubscriptionQuantity(subscriptionId, quantity, updateOptions) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['created', 'authenticated', 'active', 'pending'], 'update');
        assertQuantity(quantity);
        if (updateOptions?.at === 'cycle_end') {
          rec.pendingQuantity = quantity;
          rec.entity.has_scheduled_changes = true;
          rec.entity.change_scheduled_at = rec.entity.current_end;
        } else {
          // An immediate change supersedes a scheduled one.
          rec.entity.quantity = quantity;
          rec.pendingQuantity = null;
          rec.entity.has_scheduled_changes = false;
          rec.entity.change_scheduled_at = null;
        }
        return view(rec);
      });
    },

    updateSubscriptionPlan(subscriptionId, input: UpdatePlanInput) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['created', 'authenticated', 'active', 'pending'], 'change the plan of');
        assertQuantity(input.quantity);
        if (input.planId.length === 0) {
          throw new BillingProviderError('invalid_input', 'planId must not be empty');
        }
        if (input.at === 'cycle_end') {
          rec.pendingPlanId = input.planId;
          rec.pendingQuantity = input.quantity;
          rec.entity.has_scheduled_changes = true;
          rec.entity.change_scheduled_at = rec.entity.current_end;
        } else {
          rec.entity.plan_id = input.planId;
          rec.interval = getPlan(input.planId)?.interval ?? rec.interval;
          rec.entity.quantity = input.quantity;
          rec.pendingPlanId = null;
          rec.pendingQuantity = null;
          rec.entity.has_scheduled_changes = false;
          rec.entity.change_scheduled_at = null;
        }
        return view(rec);
      });
    },

    cancelSubscription(subscriptionId, cancelOptions: CancelOptions) {
      return attempt(() => {
        const rec = record(subscriptionId);
        if (cancelOptions.atCycleEnd) {
          assertStatus(rec, ['active', 'pending'], 'cancel at cycle end');
          rec.cancelAtCycleEnd = true;
          rec.entity.end_at = rec.entity.current_end;
          return view(rec);
        }
        assertStatus(rec, EVENT_FROM['subscription.cancelled'], 'cancel');
        cancelNow(rec);
        return view(rec);
      });
    },

    withdrawCancellation(subscriptionId) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['active', 'pending'], 'withdraw the cancellation of');
        if (!rec.cancelAtCycleEnd) {
          throw new BillingProviderError(
            'invalid_state',
            `Subscription ${subscriptionId} has no scheduled cancellation`,
          );
        }
        rec.cancelAtCycleEnd = false;
        rec.entity.end_at = null;
        return view(rec);
      });
    },

    adoptSubscription(input) {
      return attempt(() => {
        const known = subscriptions.get(input.id);
        if (known) return view(known);
        assertQuantity(input.quantity);
        const unix = (date: Date | null) =>
          date === null ? null : Math.floor(date.getTime() / 1000);
        const rec: SubscriptionRecord = {
          interval: getPlan(input.planId)?.interval ?? 'month',
          cancelAtCycleEnd: input.cancelAtCycleEnd,
          mandate: input.status === 'created' ? 'created' : 'active',
          pendingQuantity: null,
          pendingPlanId: null,
          retryOutcome: 'failed',
          entity: {
            id: input.id,
            entity: 'subscription',
            plan_id: input.planId,
            customer_id: input.customerId,
            status: input.status,
            current_start: unix(input.currentStart),
            current_end: unix(input.currentEnd),
            ended_at: null,
            quantity: input.quantity,
            notes: [],
            charge_at: unix(input.currentEnd),
            start_at: unix(input.currentStart),
            end_at: input.cancelAtCycleEnd ? unix(input.currentEnd) : null,
            auth_attempts: 0,
            total_count: DEFAULT_TOTAL_COUNT,
            paid_count: input.currentStart === null ? 0 : 1,
            customer_notify: true,
            created_at: seconds(),
            expire_by: null,
            short_url: `${MOCK_MANDATE_BASE_URL}${input.id}`,
            has_scheduled_changes: false,
            change_scheduled_at: null,
            source: 'api',
            payment_method: 'upi',
            offer_id: null,
            remaining_count: DEFAULT_TOTAL_COUNT - (input.currentStart === null ? 0 : 1),
          },
        };
        subscriptions.set(input.id, rec);
        return view(rec);
      });
    },

    pause(subscriptionId) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['active'], 'pause');
        rec.entity.status = 'paused';
        rec.entity.charge_at = null;
        rec.mandate = 'paused';
        return view(rec);
      });
    },

    resume(subscriptionId) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['paused'], 'resume');
        rec.entity.status = 'active';
        rec.entity.charge_at = rec.entity.current_end;
        rec.mandate = 'active';
        return view(rec);
      });
    },

    fetchSubscription(subscriptionId) {
      return attempt(() => view(record(subscriptionId)));
    },

    createMandateLink(subscriptionId): Promise<MandateLink> {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['created'], 'create a mandate link for');
        if (rec.mandate === 'failed') rec.mandate = 'created';
        return {
          subscriptionId,
          url: rec.entity.short_url ?? `${MOCK_MANDATE_BASE_URL}${subscriptionId}`,
          status: rec.mandate,
        };
      });
    },

    updatePaymentMethod(subscriptionId): Promise<MandateLink> {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(
          rec,
          ['created', 'authenticated', 'active', 'pending', 'halted', 'paused'],
          'update the payment method of',
        );
        rec.mandate = 'created';
        return {
          subscriptionId,
          url: rec.entity.short_url ?? `${MOCK_MANDATE_BASE_URL}${subscriptionId}`,
          status: rec.mandate,
        };
      });
    },

    confirmPaymentMethod(subscriptionId) {
      return attempt(() => {
        const rec = record(subscriptionId);
        if (rec.entity.status === 'created') {
          // First authorisation of a checkout that was not completed yet.
          rec.entity.auth_attempts += 1;
          rec.mandate = 'active';
          rec.entity.status = 'active';
          startPeriod(rec, rec.entity.start_at ?? seconds());
          return emit(rec, 'subscription.activated');
        }
        rec.mandate = 'active';
        if (rec.entity.status !== 'pending' && rec.entity.status !== 'halted') return null;
        rec.entity.status = 'active';
        startPeriod(rec, rec.entity.current_end ?? seconds());
        return emit(rec, 'subscription.charged', payment(rec, 'captured'));
      });
    },

    authorizeMandate(subscriptionId) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['created'], 'authorise the mandate of');
        if (rec.mandate !== 'created') {
          throw new BillingProviderError(
            'invalid_state',
            `Mandate of ${subscriptionId} is ${rec.mandate}, not created`,
          );
        }
        rec.entity.auth_attempts += 1;
        rec.mandate = 'active';
        rec.entity.status = 'active';
        startPeriod(rec, rec.entity.start_at ?? seconds());
        return emit(rec, 'subscription.activated');
      });
    },

    setMandateState(subscriptionId, state) {
      return attempt(() => {
        const rec = record(subscriptionId);
        rec.mandate = state;
        return view(rec);
      });
    },

    simulate(subscriptionId, event) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, EVENT_FROM[event], `raise ${event} on`);
        switch (event) {
          case 'subscription.charged': {
            // Razorpay ends a cancel-at-cycle-end subscription with `subscription.cancelled`.
            if (rec.cancelAtCycleEnd) {
              throw new BillingProviderError(
                'invalid_state',
                `Subscription ${subscriptionId} is cancelled at cycle end`,
              );
            }
            rec.entity.status = 'active';
            rec.mandate = 'active';
            startPeriod(rec, rec.entity.current_end ?? seconds());
            return emit(rec, event, payment(rec, 'captured'));
          }
          case 'payment.failed': {
            rec.entity.status = 'pending';
            rec.entity.auth_attempts += 1;
            return emit(rec, event, payment(rec, 'failed'));
          }
          case 'subscription.halted': {
            rec.entity.status = 'halted';
            rec.entity.charge_at = null;
            return emit(rec, event);
          }
          case 'subscription.cancelled': {
            cancelNow(rec);
            return emit(rec, event);
          }
        }
      });
    },

    retryPayment(subscriptionId) {
      return attempt(() => {
        const rec = record(subscriptionId);
        assertStatus(rec, ['pending', 'halted'], 'retry the payment of');
        if (rec.retryOutcome === 'charged') {
          rec.entity.status = 'active';
          rec.mandate = 'active';
          startPeriod(rec, rec.entity.current_end ?? seconds());
          emit(rec, 'subscription.charged', payment(rec, 'captured'));
          return { subscription: view(rec), outcome: 'charged' as const };
        }
        rec.entity.auth_attempts += 1;
        emit(rec, 'payment.failed', payment(rec, 'failed'));
        return { subscription: view(rec), outcome: 'failed' as const };
      });
    },

    setRetryOutcome(subscriptionId, outcome) {
      record(subscriptionId).retryOutcome = outcome;
    },

    deliveries() {
      return structuredClone(log);
    },
  };

  function cancelNow(rec: SubscriptionRecord): void {
    rec.entity.status = 'cancelled';
    rec.entity.ended_at = seconds();
    rec.entity.charge_at = null;
    rec.cancelAtCycleEnd = false;
    rec.mandate = 'cancelled';
  }

  return provider;
}

/** Run synchronously, reporting failures as a rejected promise like a real provider would. */
function attempt<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function toDate(unixSeconds: number | null): Date | null {
  return unixSeconds === null ? null : new Date(unixSeconds * 1000);
}

/** Add one billing interval in UTC, clamping to the last day of shorter months (31 Jan → 28/29 Feb). */
export function addInterval(unixSeconds: number, interval: PlanInterval): number {
  const date = new Date(unixSeconds * 1000);
  const months = interval === 'year' ? 12 : 1;
  const target = new Date(date.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return Math.floor(target.getTime() / 1000);
}
