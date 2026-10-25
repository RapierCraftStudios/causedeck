// `@causedeck/billing/provider` (#201): the billing provider selected by `BILLING_PROVIDER`.
// Server-only (the Razorpay SDK pulls in axios and node built-ins), so it is a subpath export and
// is not re-exported from the package barrel that `apps/web` imports.
import type { Secret } from '@causedeck/config/env';

import { createMockBillingProvider, type MockBillingProviderOptions } from './mock';
import { createRazorpayProvider, type RazorpayClientLike } from './razorpay';
import type { BillingProvider } from './types';

export * from './types';
export {
  addInterval,
  createMockBillingProvider,
  MOCK_ACCOUNT_ID,
  MOCK_EPOCH,
  MOCK_MANDATE_BASE_URL,
  signMockDelivery,
  type MockBillingProvider,
  type MockBillingProviderOptions,
  type MockWebhookDelivery,
  type SignedMockDelivery,
} from './mock';
export {
  createRazorpayProvider,
  toSubscription,
  type RazorpayClientLike,
  type RazorpayCustomerResponse,
  type RazorpayProviderOptions,
  type RazorpaySubscriptionCreateParams,
  type RazorpaySubscriptionResponse,
} from './razorpay';

/** The billing branch of the validated server env (`@causedeck/config/env`, #4). */
export type BillingProviderEnv =
  | { BILLING_PROVIDER: 'mock' }
  | {
      BILLING_PROVIDER: 'razorpay';
      RAZORPAY_KEY_ID: string;
      RAZORPAY_SECRET: Secret;
      RAZORPAY_WEBHOOK_SECRET: Secret;
    };

export interface CreateBillingProviderOptions {
  mock?: MockBillingProviderOptions;
  razorpayClient?: RazorpayClientLike;
}

/**
 * Build the provider for `env.BILLING_PROVIDER`. `mock` needs no Razorpay keys; the env schema
 * rejects `mock` in production unless `ALLOW_MOCK_PROVIDERS=true`.
 */
export function createBillingProvider(
  env: BillingProviderEnv,
  options: CreateBillingProviderOptions = {},
): BillingProvider {
  switch (env.BILLING_PROVIDER) {
    case 'mock':
      return createMockBillingProvider(options.mock);
    case 'razorpay':
      return createRazorpayProvider({
        keyId: env.RAZORPAY_KEY_ID,
        keySecret: env.RAZORPAY_SECRET,
        ...(options.razorpayClient ? { client: options.razorpayClient } : {}),
      });
  }
}

/** The webhook signing secret, still wrapped, for signature verification (#204). */
export function getRazorpayWebhookSecret(env: BillingProviderEnv): Secret | null {
  return env.BILLING_PROVIDER === 'razorpay' ? env.RAZORPAY_WEBHOOK_SECRET : null;
}
