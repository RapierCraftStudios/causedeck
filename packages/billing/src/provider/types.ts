// Billing provider contract (#28 part 2, #201; spike §1 Payments row). The billing service (#202)
// and the webhook pipeline (#204) talk to Razorpay only through `BillingProvider`, so dev and CI
// run the deterministic mock without network or credentials. Amounts are integer paise and
// timestamps are `Date`s; the Razorpay adapter converts from the SDK's unix seconds.

export type BillingProviderName = 'mock' | 'razorpay';

/** Razorpay subscription statuses (https://razorpay.com/docs/payments/subscriptions/states/). */
export const PROVIDER_SUBSCRIPTION_STATUSES = [
  'created',
  'authenticated',
  'active',
  'pending',
  'halted',
  'cancelled',
  'completed',
  'paused',
  'expired',
] as const;
export type ProviderSubscriptionStatus = (typeof PROVIDER_SUBSCRIPTION_STATUSES)[number];

/** UPI Autopay mandate lifecycle, as reported by the provider's authorisation flow. */
export const MANDATE_STATES = [
  'created',
  'authenticated',
  'active',
  'paused',
  'cancelled',
  'failed',
] as const;
export type MandateState = (typeof MANDATE_STATES)[number];

/** Provider events the mock can raise; each yields a Razorpay-shaped webhook payload. */
export const SIMULATED_EVENTS = [
  'subscription.charged',
  'payment.failed',
  'subscription.halted',
  'subscription.cancelled',
] as const;
export type SimulatedEvent = (typeof SIMULATED_EVENTS)[number];

export interface BillingCustomer {
  id: string;
  email: string;
  name: string | null;
}

export interface BillingMandate {
  method: 'upi';
  state: MandateState;
}

export interface BillingSubscription {
  id: string;
  customerId: string | null;
  /** The provider's plan id (Razorpay `plan_…`; the mock accepts catalogue ids). */
  planId: string;
  status: ProviderSubscriptionStatus;
  quantity: number;
  currentStart: Date | null;
  currentEnd: Date | null;
  chargeAt: Date | null;
  cancelAtCycleEnd: boolean;
  /** Hosted authorisation link for the UPI Autopay mandate. */
  shortUrl: string | null;
  mandate: BillingMandate | null;
  /** Quantity scheduled to take effect at the next cycle (`null` when nothing is scheduled). */
  pendingQuantity: number | null;
}

export interface MandateLink {
  subscriptionId: string;
  url: string;
  status: MandateState;
}

export interface CreateCustomerInput {
  email: string;
  name?: string;
  contact?: string;
  notes?: Record<string, string>;
}

export interface CreateSubscriptionInput {
  customerId: string;
  planId: string;
  quantity: number;
  /** Number of billing cycles; defaults to 120 (ten years of monthly charges). */
  totalCount?: number;
  startAt?: Date;
  notes?: Record<string, string>;
}

export interface CancelOptions {
  /** Keep the subscription running until the current period ends. */
  atCycleEnd: boolean;
}

export interface UpdateQuantityOptions {
  /** `now` applies the quantity immediately; `cycle_end` from the next billing cycle. */
  at: 'now' | 'cycle_end';
}

/**
 * What a payment retry did. `provider_scheduled`: the provider retries on its own schedule and
 * nothing was charged by this call.
 */
export type PaymentRetryOutcome = 'charged' | 'failed' | 'provider_scheduled';

export interface PaymentRetryResult {
  subscription: BillingSubscription;
  outcome: PaymentRetryOutcome;
}

export interface BillingProvider {
  readonly name: BillingProviderName;
  createCustomer(input: CreateCustomerInput): Promise<BillingCustomer>;
  createSubscription(input: CreateSubscriptionInput): Promise<BillingSubscription>;
  updateSubscriptionQuantity(
    subscriptionId: string,
    quantity: number,
    options?: UpdateQuantityOptions,
  ): Promise<BillingSubscription>;
  cancelSubscription(subscriptionId: string, options: CancelOptions): Promise<BillingSubscription>;
  pause(subscriptionId: string): Promise<BillingSubscription>;
  resume(subscriptionId: string): Promise<BillingSubscription>;
  fetchSubscription(subscriptionId: string): Promise<BillingSubscription>;
  createMandateLink(subscriptionId: string): Promise<MandateLink>;
  /**
   * Retry a failed subscription charge (dunning, #205). The subscription's state still changes
   * only through webhooks (`subscription.charged` / `payment.failed`), never from this result.
   */
  retryPayment(subscriptionId: string): Promise<PaymentRetryResult>;
}

/** Razorpay webhook body (https://razorpay.com/docs/webhooks/payloads/subscriptions/). */
export interface RazorpayWebhookEvent {
  entity: 'event';
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    subscription?: { entity: RazorpaySubscriptionEntity };
    payment?: { entity: RazorpayPaymentEntity };
  };
  created_at: number;
}

export interface RazorpaySubscriptionEntity {
  id: string;
  entity: 'subscription';
  plan_id: string;
  customer_id: string | null;
  status: ProviderSubscriptionStatus;
  current_start: number | null;
  current_end: number | null;
  ended_at: number | null;
  quantity: number;
  notes: Record<string, string> | [];
  charge_at: number | null;
  start_at: number | null;
  end_at: number | null;
  auth_attempts: number;
  total_count: number;
  paid_count: number;
  customer_notify: boolean;
  created_at: number;
  expire_by: number | null;
  short_url: string | null;
  has_scheduled_changes: boolean;
  change_scheduled_at: number | null;
  source: string;
  payment_method: string | null;
  offer_id: string | null;
  remaining_count: number;
}

export interface RazorpayPaymentEntity {
  id: string;
  entity: 'payment';
  amount: number;
  currency: 'INR';
  status: 'captured' | 'failed';
  order_id: string | null;
  invoice_id: string | null;
  method: 'upi';
  description: string | null;
  customer_id: string | null;
  email: string;
  contact: string;
  error_code: string | null;
  error_description: string | null;
  created_at: number;
}

export type BillingProviderErrorCode = 'not_found' | 'invalid_state' | 'invalid_input' | 'provider';

/**
 * A provider call failed. Carries only the provider's own error code and description: never the
 * request, its headers or the credentials.
 */
export class BillingProviderError extends Error {
  readonly code: BillingProviderErrorCode;
  readonly providerCode: string | null;
  readonly statusCode: number | null;

  constructor(
    code: BillingProviderErrorCode,
    message: string,
    details: { providerCode?: string | null; statusCode?: number | null } = {},
  ) {
    super(message);
    this.name = 'BillingProviderError';
    this.code = code;
    this.providerCode = details.providerCode ?? null;
    this.statusCode = details.statusCode ?? null;
  }
}
