import { describe, expect, it, vi } from 'vitest';

import {
  BillingProviderError,
  createMockBillingProvider,
  PROVIDER_SUBSCRIPTION_STATUSES,
  type BillingProvider,
  type MockBillingProvider,
} from '../provider';
import {
  PROVIDER_TO_LOCAL_STATUS,
  reconcileSubscriptions,
  type ReconcileSubscriptionInput,
} from '../reconcile';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';

async function activeSubscription(provider: MockBillingProvider, quantity = 3) {
  const customer = await provider.createCustomer({ email: 'advocate@example.com', name: 'Asha' });
  const created = await provider.createSubscription({
    customerId: customer.id,
    planId: 'chamber-seat-1',
    quantity,
  });
  await provider.authorizeMandate(created.id);
  return provider.fetchSubscription(created.id);
}

function localRow(
  overrides: Partial<ReconcileSubscriptionInput> & { providerSubscriptionId: string | null },
): ReconcileSubscriptionInput {
  return {
    workspaceId: WORKSPACE,
    id: 'local-sub-1',
    status: 'active',
    seats: 3,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

/** Spy on every provider method; reconciliation may call only `fetchSubscription`. */
function spied(provider: MockBillingProvider) {
  const methods = [
    'createCustomer',
    'createSubscription',
    'updateSubscriptionQuantity',
    'cancelSubscription',
    'pause',
    'resume',
    'createMandateLink',
    'fetchSubscription',
  ] as const;
  return Object.fromEntries(methods.map((m) => [m, vi.spyOn(provider, m)])) as Record<
    (typeof methods)[number],
    ReturnType<typeof vi.spyOn>
  >;
}

describe('PROVIDER_TO_LOCAL_STATUS', () => {
  it('maps every provider status', () => {
    expect(Object.keys(PROVIDER_TO_LOCAL_STATUS).sort()).toEqual(
      [...PROVIDER_SUBSCRIPTION_STATUSES].sort(),
    );
  });
});

describe('reconcileSubscriptions (mock provider)', () => {
  it('reports nothing when local state matches the provider', async () => {
    const provider = createMockBillingProvider();
    const remote = await activeSubscription(provider);

    const report = await reconcileSubscriptions({
      provider,
      subscriptions: [
        localRow({
          providerSubscriptionId: remote.id,
          currentPeriodEnd: remote.currentEnd,
        }),
      ],
    });

    expect(report).toEqual({ checked: 1, discrepancies: [] });
  });

  it('reports status, seat, period and cancel drift without mutating anything', async () => {
    const provider = createMockBillingProvider();
    const remote = await activeSubscription(provider);
    await provider.simulate(remote.id, 'subscription.halted');
    const before = await provider.fetchSubscription(remote.id);
    const spies = spied(provider);
    const local = localRow({
      providerSubscriptionId: remote.id,
      status: 'active',
      seats: 5,
      currentPeriodEnd: new Date((before.currentEnd?.getTime() ?? 0) - 86_400_000),
      cancelAtPeriodEnd: true,
    });
    const snapshot = structuredClone(local);

    const report = await reconcileSubscriptions({ provider, subscriptions: [local] });

    expect(report.checked).toBe(1);
    expect(report.discrepancies.map((d) => [d.field, d.local, d.remote])).toEqual([
      ['status', 'active', 'halted'],
      ['seats', 5, 3],
      [
        'current_period_end',
        snapshot.currentPeriodEnd?.toISOString(),
        before.currentEnd?.toISOString(),
      ],
      ['cancel_at_period_end', true, false],
    ]);
    for (const d of report.discrepancies) {
      expect(d).toMatchObject({
        workspaceId: WORKSPACE,
        subscriptionId: 'local-sub-1',
        providerSubscriptionId: remote.id,
      });
    }
    // Read-only: one fetch, no mutating provider call, provider and input untouched.
    expect(spies.fetchSubscription).toHaveBeenCalledTimes(1);
    for (const [name, spy] of Object.entries(spies)) {
      if (name !== 'fetchSubscription') expect(spy).not.toHaveBeenCalled();
    }
    expect(await provider.fetchSubscription(remote.id)).toEqual(before);
    expect(local).toEqual(snapshot);
  });

  it('reports a subscription the provider does not know and keeps going', async () => {
    const provider = createMockBillingProvider();
    const remote = await activeSubscription(provider);

    const report = await reconcileSubscriptions({
      provider,
      subscriptions: [
        localRow({ id: 'gone', providerSubscriptionId: 'sub_mock_missing' }),
        localRow({ id: 'kept', providerSubscriptionId: remote.id }),
      ],
    });

    expect(report.checked).toBe(2);
    expect(report.discrepancies).toEqual([
      {
        workspaceId: WORKSPACE,
        subscriptionId: 'gone',
        providerSubscriptionId: 'sub_mock_missing',
        field: 'missing_at_provider',
        local: 'active',
        remote: null,
      },
    ]);
  });

  it('records other provider failures by code only, never the message', async () => {
    const provider: Pick<BillingProvider, 'fetchSubscription'> = {
      fetchSubscription: () =>
        Promise.reject(
          new BillingProviderError('provider', 'upstream said key_secret=rzp-leak', {
            statusCode: 502,
          }),
        ),
    };

    const report = await reconcileSubscriptions({
      provider,
      subscriptions: [localRow({ providerSubscriptionId: 'sub_x' })],
    });

    expect(report.discrepancies).toEqual([
      expect.objectContaining({ field: 'fetch_failed', remote: 'provider' }),
    ]);
    expect(JSON.stringify(report)).not.toContain('rzp-leak');
  });

  it('skips rows that never reached the provider', async () => {
    const provider = { fetchSubscription: vi.fn() };

    const report = await reconcileSubscriptions({
      provider,
      subscriptions: [localRow({ providerSubscriptionId: null })],
    });

    expect(report).toEqual({ checked: 0, discrepancies: [] });
    expect(provider.fetchSubscription).not.toHaveBeenCalled();
  });
});
