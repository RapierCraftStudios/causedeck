// Razorpay adapter (#201) on the official `razorpay` SDK: Subscriptions API with UPI Autopay, the
// mandate being authorised through the subscription's hosted `short_url`. Real credentials arrive
// with #109; dev and CI use the mock.
//
// Secret hygiene: the key secret is revealed only in the SDK constructor call. The SDK client
// keeps it (and axios keeps it in its request config), so the client lives in this closure and is
// never put on the returned object, and SDK errors are rethrown without their request or config.
import type { Secret } from '@causedeck/config/env';
import Razorpay from 'razorpay';

import {
  BillingProviderError,
  PROVIDER_SUBSCRIPTION_STATUSES,
  type BillingCustomer,
  type BillingProvider,
  type BillingSubscription,
  type MandateState,
  type ProviderSubscriptionStatus,
} from './types';

const DEFAULT_TOTAL_COUNT = 120;

/** The subset of a Razorpay subscription response the adapter reads. */
export interface RazorpaySubscriptionResponse {
  id: string;
  plan_id: string;
  customer_id?: string | null | undefined;
  status: string;
  quantity?: number | undefined;
  current_start?: number | null | undefined;
  current_end?: number | null | undefined;
  charge_at?: number | null | undefined;
  end_at?: number | null | undefined;
  short_url?: string | null | undefined;
  payment_method?: string | null | undefined;
}

export interface RazorpayCustomerResponse {
  id: string;
  email?: string | undefined;
  name?: string | undefined;
}

export interface RazorpaySubscriptionCreateParams {
  plan_id: string;
  total_count: number;
  quantity: number;
  customer_notify: boolean;
  customer_id: string;
  start_at?: number;
  notes?: Record<string, string>;
}

/** The SDK surface the adapter uses; tests inject a fake. */
export interface RazorpayClientLike {
  customers: {
    create(params: {
      email: string;
      name?: string;
      contact?: string;
      notes?: Record<string, string>;
      fail_existing: 0 | 1;
    }): Promise<RazorpayCustomerResponse>;
  };
  subscriptions: {
    create(params: RazorpaySubscriptionCreateParams): Promise<RazorpaySubscriptionResponse>;
    update(
      id: string,
      params: { plan_id?: string; quantity: number; schedule_change_at?: 'now' | 'cycle_end' },
    ): Promise<RazorpaySubscriptionResponse>;
    cancel(id: string, cancelAtCycleEnd: boolean): Promise<RazorpaySubscriptionResponse>;
    pause(id: string, params: { pause_at: 'now' }): Promise<RazorpaySubscriptionResponse>;
    resume(id: string, params: { resume_at: 'now' }): Promise<RazorpaySubscriptionResponse>;
    fetch(id: string): Promise<RazorpaySubscriptionResponse>;
  };
}

export interface RazorpayProviderOptions {
  keyId: string;
  keySecret: Secret;
  /** Injected SDK client (tests). Defaults to the official SDK. */
  client?: RazorpayClientLike;
}

export function createRazorpayProvider(options: RazorpayProviderOptions): BillingProvider {
  const client: RazorpayClientLike =
    options.client ??
    (new Razorpay({
      key_id: options.keyId,
      key_secret: options.keySecret.reveal(),
    }) satisfies RazorpayClientLike);

  return {
    name: 'razorpay',

    createCustomer(input) {
      return call(async (): Promise<BillingCustomer> => {
        const customer = await client.customers.create({
          email: input.email,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.contact === undefined ? {} : { contact: input.contact }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          // Return the existing customer for a repeated email instead of failing.
          fail_existing: 0,
        });
        return {
          id: customer.id,
          email: customer.email ?? input.email,
          name: customer.name ?? null,
        };
      });
    },

    createSubscription(input) {
      return call(async () =>
        toSubscription(
          await client.subscriptions.create({
            plan_id: input.planId,
            total_count: input.totalCount ?? DEFAULT_TOTAL_COUNT,
            quantity: input.quantity,
            customer_notify: true,
            customer_id: input.customerId,
            ...(input.startAt === undefined ? {} : { start_at: unixSeconds(input.startAt) }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
          }),
        ),
      );
    },

    updateSubscriptionQuantity(subscriptionId, quantity, updateOptions) {
      return call(async () =>
        toSubscription(
          await client.subscriptions.update(subscriptionId, {
            quantity,
            ...(updateOptions?.at === 'cycle_end' ? { schedule_change_at: 'cycle_end' } : {}),
          }),
        ),
      );
    },

    updateSubscriptionPlan(subscriptionId, input) {
      return call(async () =>
        toSubscription(
          await client.subscriptions.update(subscriptionId, {
            plan_id: input.planId,
            quantity: input.quantity,
            schedule_change_at: input.at,
          }),
        ),
      );
    },

    cancelSubscription(subscriptionId, cancelOptions) {
      return call(async () =>
        toSubscription(await client.subscriptions.cancel(subscriptionId, cancelOptions.atCycleEnd)),
      );
    },

    withdrawCancellation() {
      // Razorpay has no API to withdraw a scheduled cancel-at-cycle-end.
      return Promise.reject(
        new BillingProviderError(
          'unsupported',
          'Razorpay cannot withdraw a scheduled cancellation; subscribe again after it ends.',
        ),
      );
    },

    pause(subscriptionId) {
      return call(async () =>
        toSubscription(await client.subscriptions.pause(subscriptionId, { pause_at: 'now' })),
      );
    },

    resume(subscriptionId) {
      return call(async () =>
        toSubscription(await client.subscriptions.resume(subscriptionId, { resume_at: 'now' })),
      );
    },

    fetchSubscription(subscriptionId) {
      return call(async () => toSubscription(await client.subscriptions.fetch(subscriptionId)));
    },

    createMandateLink(subscriptionId) {
      return call(async () => {
        const subscription = toSubscription(await client.subscriptions.fetch(subscriptionId));
        if (subscription.shortUrl === null || subscription.mandate === null) {
          throw new BillingProviderError(
            'invalid_state',
            `Subscription ${subscriptionId} has no authorisation link`,
          );
        }
        return { subscriptionId, url: subscription.shortUrl, status: subscription.mandate.state };
      });
    },

    retryPayment(subscriptionId) {
      // Razorpay has no merchant API to retry a subscription charge: it retries a `pending`
      // subscription itself and reports the result by webhook. So this makes no write call and
      // never claims a charge; it only reads the current state.
      return call(async () => ({
        subscription: toSubscription(await client.subscriptions.fetch(subscriptionId)),
        outcome: 'provider_scheduled' as const,
      }));
    },
  };
}

/** Map an SDK subscription to the provider-neutral shape. */
export function toSubscription(raw: RazorpaySubscriptionResponse): BillingSubscription {
  const status = toStatus(raw.status);
  const shortUrl = raw.short_url ?? null;
  return {
    id: raw.id,
    customerId: raw.customer_id ?? null,
    planId: raw.plan_id,
    status,
    quantity: raw.quantity ?? 1,
    currentStart: toDate(raw.current_start),
    currentEnd: toDate(raw.current_end),
    chargeAt: toDate(raw.charge_at),
    cancelAtCycleEnd:
      raw.end_at !== undefined &&
      raw.end_at !== null &&
      raw.current_end !== undefined &&
      raw.end_at === raw.current_end &&
      !['cancelled', 'completed', 'expired'].includes(status),
    shortUrl,
    mandate: shortUrl === null ? null : { method: 'upi', state: MANDATE_BY_STATUS[status] },
    // A scheduled change is not part of the subscription response.
    pendingQuantity: null,
  };
}

const MANDATE_BY_STATUS: Record<ProviderSubscriptionStatus, MandateState> = {
  created: 'created',
  authenticated: 'authenticated',
  active: 'active',
  pending: 'active',
  halted: 'active',
  paused: 'paused',
  cancelled: 'cancelled',
  completed: 'cancelled',
  expired: 'cancelled',
};

function toStatus(status: string): ProviderSubscriptionStatus {
  if ((PROVIDER_SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
    return status as ProviderSubscriptionStatus;
  }
  throw new BillingProviderError('provider', `Unknown Razorpay subscription status ${status}`);
}

function toDate(unix: number | null | undefined): Date | null {
  return unix === undefined || unix === null ? null : new Date(unix * 1000);
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Razorpay's SDK rejects with `{ statusCode, error: { code, description } }`. */
interface RazorpaySdkError {
  statusCode?: number;
  error: { code?: string; description?: string };
}

function isRazorpaySdkError(error: unknown): error is RazorpaySdkError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'object' &&
    error.error !== null
  );
}

/**
 * Run an SDK call and rethrow failures as `BillingProviderError`. Only the provider's code and
 * description survive; transport errors (which carry the axios config with the basic-auth
 * credentials) become a generic message and are not attached as `cause`.
 */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof BillingProviderError) throw error;
    if (isRazorpaySdkError(error)) {
      const statusCode = typeof error.statusCode === 'number' ? error.statusCode : null;
      throw new BillingProviderError(
        statusCode === 404 ? 'not_found' : 'provider',
        error.error.description ?? 'Razorpay request failed',
        { providerCode: error.error.code ?? null, statusCode },
      );
    }
    throw new BillingProviderError('provider', 'Razorpay request failed');
  }
}
