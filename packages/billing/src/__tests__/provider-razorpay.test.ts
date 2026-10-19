import { inspect } from 'node:util';

import { Secret } from '@causedeck/config/env';
import { afterEach, describe, expect, it, vi } from 'vitest';

import customerFixture from '../__fixtures__/razorpay/customer.create.json';
import createdFixture from '../__fixtures__/razorpay/subscription.create.json';
import fetchFixture from '../__fixtures__/razorpay/subscription.fetch.json';
import {
  BillingProviderError,
  createRazorpayProvider,
  type BillingProvider,
  type RazorpayClientLike,
  type RazorpaySubscriptionResponse,
} from '../provider';

const KEY_SECRET = 'rzp-test-key-secret-do-not-log';

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeClient(overrides: Partial<RazorpayClientLike['subscriptions']> = {}) {
  const sub = (patch: Partial<RazorpaySubscriptionResponse> = {}) =>
    Promise.resolve({ ...fetchFixture, ...patch });
  const client = {
    customers: { create: vi.fn(() => Promise.resolve(customerFixture)) },
    subscriptions: {
      create: vi.fn(() => Promise.resolve(createdFixture)),
      update: vi.fn(
        (_id: string, params: { quantity: number; schedule_change_at?: 'now' | 'cycle_end' }) =>
          sub({ quantity: params.quantity }),
      ),
      cancel: vi.fn((_id: string, atCycleEnd: boolean) =>
        atCycleEnd
          ? sub({ end_at: fetchFixture.current_end })
          : sub({ status: 'cancelled', charge_at: null }),
      ),
      pause: vi.fn(() => sub({ status: 'paused', charge_at: null })),
      resume: vi.fn(() => sub({ status: 'active' })),
      fetch: vi.fn(() => sub()),
      ...overrides,
    },
  } satisfies RazorpayClientLike;
  return client;
}

function provider(client: RazorpayClientLike): BillingProvider {
  return createRazorpayProvider({
    keyId: 'rzp_test_FIXTURE',
    keySecret: new Secret(KEY_SECRET),
    client,
  });
}

describe('Razorpay adapter: request mapping', () => {
  it('creates a customer without failing on an existing email', async () => {
    const client = fakeClient();
    const customer = await provider(client).createCustomer({
      email: 'advocate@example.com',
      name: 'Asha Advocate',
    });
    expect(client.customers.create).toHaveBeenCalledWith({
      email: 'advocate@example.com',
      name: 'Asha Advocate',
      fail_existing: 0,
    });
    expect(customer).toEqual({
      id: 'cust_FIXTURE0000001',
      email: 'advocate@example.com',
      name: 'Asha Advocate',
    });
  });

  it('creates a subscription with plan, quantity and customer notification', async () => {
    const client = fakeClient();
    const subscription = await provider(client).createSubscription({
      customerId: 'cust_FIXTURE0000001',
      planId: 'plan_FIXTURE0000001',
      quantity: 3,
      totalCount: 24,
      startAt: new Date('2026-01-01T00:00:00Z'),
      notes: { workspace_ref: 'ws_FIXTURE0000001' },
    });
    expect(client.subscriptions.create).toHaveBeenCalledWith({
      plan_id: 'plan_FIXTURE0000001',
      total_count: 24,
      quantity: 3,
      customer_notify: true,
      customer_id: 'cust_FIXTURE0000001',
      start_at: 1_767_225_600,
      notes: { workspace_ref: 'ws_FIXTURE0000001' },
    });
    expect(subscription).toEqual({
      id: 'sub_FIXTURE0000001',
      customerId: 'cust_FIXTURE0000001',
      planId: 'plan_FIXTURE0000001',
      status: 'created',
      quantity: 3,
      currentStart: null,
      currentEnd: null,
      chargeAt: null,
      cancelAtCycleEnd: false,
      shortUrl: 'https://rzp.io/i/FIXTURE01',
      mandate: { method: 'upi', state: 'created' },
      pendingQuantity: null,
    });
  });

  it('defaults total_count and omits optional fields', async () => {
    const client = fakeClient();
    await provider(client).createSubscription({
      customerId: 'cust_FIXTURE0000001',
      planId: 'plan_FIXTURE0000001',
      quantity: 1,
    });
    expect(client.subscriptions.create).toHaveBeenCalledWith({
      plan_id: 'plan_FIXTURE0000001',
      total_count: 120,
      quantity: 1,
      customer_notify: true,
      customer_id: 'cust_FIXTURE0000001',
    });
  });

  it('maps a fetched subscription', async () => {
    const subscription = await provider(fakeClient()).fetchSubscription('sub_FIXTURE0000001');
    expect(subscription).toMatchObject({
      status: 'active',
      quantity: 3,
      currentStart: new Date('2026-01-01T00:00:00Z'),
      currentEnd: new Date('2026-02-01T00:00:00Z'),
      chargeAt: new Date('2026-02-01T00:00:00Z'),
      cancelAtCycleEnd: false,
      mandate: { method: 'upi', state: 'active' },
    });
  });

  it('updates the quantity', async () => {
    const client = fakeClient();
    const result = await provider(client).updateSubscriptionQuantity('sub_FIXTURE0000001', 5);
    expect(client.subscriptions.update).toHaveBeenCalledWith('sub_FIXTURE0000001', {
      quantity: 5,
    });
    expect(result.quantity).toBe(5);
  });

  it('schedules a quantity change for cycle end', async () => {
    const client = fakeClient();
    await provider(client).updateSubscriptionQuantity('sub_FIXTURE0000001', 2, { at: 'cycle_end' });
    expect(client.subscriptions.update).toHaveBeenCalledWith('sub_FIXTURE0000001', {
      quantity: 2,
      schedule_change_at: 'cycle_end',
    });
  });

  it('keeps the immediate call shape for { at: now }', async () => {
    const client = fakeClient();
    await provider(client).updateSubscriptionQuantity('sub_FIXTURE0000001', 4, { at: 'now' });
    expect(client.subscriptions.update).toHaveBeenCalledWith('sub_FIXTURE0000001', {
      quantity: 4,
    });
  });

  it('resumes now', async () => {
    const client = fakeClient();
    const result = await provider(client).resume('sub_FIXTURE0000001');
    expect(client.subscriptions.resume).toHaveBeenCalledWith('sub_FIXTURE0000001', {
      resume_at: 'now',
    });
    expect(result).toMatchObject({ status: 'active', pendingQuantity: null });
  });

  it('maps resume SDK errors to BillingProviderError', async () => {
    const client = fakeClient({
      resume: vi.fn(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the SDK rejects with a plain object.
        Promise.reject({
          statusCode: 400,
          error: { code: 'BAD_REQUEST_ERROR', description: 'Subscription is not paused' },
        }),
      ),
    });
    const error: unknown = await provider(client)
      .resume('sub_FIXTURE0000001')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BillingProviderError);
    expect(error).toMatchObject({ code: 'provider', providerCode: 'BAD_REQUEST_ERROR' });
    expect(JSON.stringify(error)).not.toContain(KEY_SECRET);
  });

  it('cancels at cycle end or immediately', async () => {
    const client = fakeClient();
    const atEnd = await provider(client).cancelSubscription('sub_FIXTURE0000001', {
      atCycleEnd: true,
    });
    expect(client.subscriptions.cancel).toHaveBeenLastCalledWith('sub_FIXTURE0000001', true);
    expect(atEnd).toMatchObject({ status: 'active', cancelAtCycleEnd: true });

    const now = await provider(client).cancelSubscription('sub_FIXTURE0000001', {
      atCycleEnd: false,
    });
    expect(client.subscriptions.cancel).toHaveBeenLastCalledWith('sub_FIXTURE0000001', false);
    expect(now).toMatchObject({
      status: 'cancelled',
      cancelAtCycleEnd: false,
      mandate: { state: 'cancelled' },
    });
  });

  it('pauses now', async () => {
    const client = fakeClient();
    const result = await provider(client).pause('sub_FIXTURE0000001');
    expect(client.subscriptions.pause).toHaveBeenCalledWith('sub_FIXTURE0000001', {
      pause_at: 'now',
    });
    expect(result).toMatchObject({ status: 'paused', mandate: { state: 'paused' } });
  });

  it('returns the hosted short_url as the UPI Autopay mandate link', async () => {
    const client = fakeClient({ fetch: vi.fn(() => Promise.resolve(createdFixture)) });
    expect(await provider(client).createMandateLink('sub_FIXTURE0000001')).toEqual({
      subscriptionId: 'sub_FIXTURE0000001',
      url: 'https://rzp.io/i/FIXTURE01',
      status: 'created',
    });
  });

  it('rejects a mandate link when Razorpay returns none', async () => {
    const client = fakeClient({
      fetch: vi.fn(() => Promise.resolve({ ...createdFixture, short_url: null })),
    });
    await expect(provider(client).createMandateLink('sub_FIXTURE0000001')).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('maps SDK errors to BillingProviderError', async () => {
    const client = fakeClient({
      fetch: vi.fn(() =>
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the SDK rejects with a plain object.
        Promise.reject({
          statusCode: 404,
          error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' },
        }),
      ),
    });
    const error: unknown = await provider(client)
      .fetchSubscription('sub_missing')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BillingProviderError);
    expect(error).toMatchObject({
      code: 'not_found',
      message: 'The id provided does not exist',
      providerCode: 'BAD_REQUEST_ERROR',
      statusCode: 404,
    });
  });

  it('rejects unknown statuses', async () => {
    const client = fakeClient({
      fetch: vi.fn(() => Promise.resolve({ ...fetchFixture, status: 'weird' })),
    });
    await expect(provider(client).fetchSubscription('sub_FIXTURE0000001')).rejects.toMatchObject({
      code: 'provider',
    });
  });
});

describe('Razorpay adapter: secret hygiene', () => {
  function spyConsole() {
    return (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
  }

  function leaks(value: unknown): boolean {
    return (
      JSON.stringify(value).includes(KEY_SECRET) ||
      inspect(value, { depth: 10, showHidden: true }).includes(KEY_SECRET) ||
      String(value).includes(KEY_SECRET)
    );
  }

  it('builds the official SDK client without exposing the secret on the provider', () => {
    const spies = spyConsole();
    const real = createRazorpayProvider({
      keyId: 'rzp_test_FIXTURE',
      keySecret: new Secret(KEY_SECRET),
    });
    expect(real.name).toBe('razorpay');
    expect(leaks(real)).toBe(false);
    expect(Object.values(real).every((v) => typeof v === 'function' || typeof v === 'string')).toBe(
      true,
    );
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('drops transport errors that carry the credentials', async () => {
    const spies = spyConsole();
    const transport = Object.assign(new Error(`Request failed for ${KEY_SECRET}`), {
      config: { auth: { username: 'rzp_test_FIXTURE', password: KEY_SECRET } },
    });
    const client = fakeClient({ fetch: vi.fn(() => Promise.reject(transport)) });
    const error: unknown = await provider(client)
      .fetchSubscription('sub_FIXTURE0000001')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BillingProviderError);
    expect(error).toMatchObject({ code: 'provider', message: 'Razorpay request failed' });
    expect(leaks(error)).toBe(false);
    expect((error as Error).stack?.includes(KEY_SECRET)).toBe(false);
    expect((error as Error).cause).toBeUndefined();
    for (const spy of spies) {
      for (const args of spy.mock.calls) expect(leaks(args)).toBe(false);
    }
  });

  it('never logs during a full set of calls', async () => {
    const spies = spyConsole();
    const p = provider(fakeClient());
    await p.createCustomer({ email: 'advocate@example.com' });
    await p.createSubscription({ customerId: 'c', planId: 'p', quantity: 1 });
    await p.updateSubscriptionQuantity('s', 2);
    await p.cancelSubscription('s', { atCycleEnd: true });
    await p.pause('s');
    await p.resume('s');
    await p.fetchSubscription('s');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
