// The billing service for owner billing actions (#257). Server-only: `@causedeck/billing/provider`
// pulls in the Razorpay SDK, so only server actions import this module (lazily).
//
// One provider per Node process (on `globalThis`, so dev hot reloads keep it). The mock provider
// keeps subscriptions in memory, so before each operation the database row is adopted into it
// (`adoptSubscription`, a no-op once known): subscriptions seeded straight into the database (the
// e2e seed's `sub_e2e_<ws>`) become actionable. Razorpay already knows every subscription.
import type { SubscriptionRow } from '@causedeck/core/billing';
import type {
  BillingProvider,
  MockBillingProvider,
  ProviderSubscriptionStatus,
} from '@causedeck/billing/provider';
import type { BillingService } from '@causedeck/billing/service';

import { serverEnv } from './env.ts';

const KEY = Symbol.for('causedeck.web.billingProvider');

type Holder = { [KEY]?: BillingProvider };

/** The provider's status for a stored row status. */
const PROVIDER_STATUS: Record<string, ProviderSubscriptionStatus> = {
  trialing: 'created',
  active: 'active',
  past_due: 'pending',
  paused: 'paused',
  cancelled: 'cancelled',
  expired: 'expired',
};

async function provider(): Promise<BillingProvider> {
  const holder = globalThis as Holder;
  const existing = holder[KEY];
  if (existing) return existing;
  const { createBillingProvider } = await import('@causedeck/billing/provider');
  const created = createBillingProvider(serverEnv(), { mock: { now: () => new Date() } });
  holder[KEY] = created;
  return created;
}

/** The billing service for `row`, with the row known to the provider. */
export async function billingServiceFor(row: SubscriptionRow): Promise<BillingService> {
  const [current, { createBillingService }] = await Promise.all([
    provider(),
    import('@causedeck/billing/service'),
  ]);
  if (current.name === 'mock' && row.providerSubscriptionId) {
    await (current as MockBillingProvider).adoptSubscription({
      id: row.providerSubscriptionId,
      customerId: row.providerCustomerId,
      planId: row.planId,
      quantity: row.seats,
      status: PROVIDER_STATUS[row.status] ?? 'active',
      currentStart: row.currentPeriodStart,
      currentEnd: row.currentPeriodEnd,
      cancelAtCycleEnd: row.cancelAtPeriodEnd,
    });
  }
  return createBillingService({ provider: current });
}
