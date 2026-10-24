import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addInterval,
  BillingProviderError,
  createMockBillingProvider,
  MOCK_EPOCH,
  MOCK_MANDATE_BASE_URL,
  SIMULATED_EVENTS,
  type MockBillingProvider,
} from '../provider';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function subscribed(provider: MockBillingProvider, quantity = 3) {
  const customer = await provider.createCustomer({ email: 'advocate@example.com', name: 'Asha' });
  return provider.createSubscription({
    customerId: customer.id,
    planId: 'chamber-seat-1',
    quantity,
  });
}

async function active(provider: MockBillingProvider) {
  const subscription = await subscribed(provider);
  await provider.authorizeMandate(subscription.id);
  return subscription.id;
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

describe('mock billing provider: full UPI Autopay flow without network', () => {
  it('creates a subscription, issues a mandate link and raises every provider event', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('network is not allowed in the mock provider');
    });
    const provider = createMockBillingProvider();

    const customer = await provider.createCustomer({ email: 'advocate@example.com' });
    expect(customer).toEqual({ id: 'cust_mock_0001', email: 'advocate@example.com', name: null });

    const created = await provider.createSubscription({
      customerId: customer.id,
      planId: 'chamber-seat-1',
      quantity: 3,
    });
    expect(created).toMatchObject({
      id: 'sub_mock_0001',
      customerId: 'cust_mock_0001',
      status: 'created',
      quantity: 3,
      currentStart: null,
      mandate: { method: 'upi', state: 'created' },
    });

    const link = await provider.createMandateLink(created.id);
    expect(link).toEqual({
      subscriptionId: 'sub_mock_0001',
      url: `${MOCK_MANDATE_BASE_URL}sub_mock_0001`,
      status: 'created',
    });

    const activated = await provider.authorizeMandate(created.id);
    expect(activated.event).toBe('subscription.activated');
    expect(activated.payload.subscription?.entity).toMatchObject({
      status: 'active',
      current_start: seconds('2026-01-01T00:00:00Z'),
      current_end: seconds('2026-02-01T00:00:00Z'),
      paid_count: 1,
    });

    const charged = await provider.simulate(created.id, 'subscription.charged');
    expect(charged).toMatchObject({
      entity: 'event',
      event: 'subscription.charged',
      contains: ['subscription', 'payment'],
    });
    expect(charged.payload.subscription?.entity).toMatchObject({
      status: 'active',
      current_start: seconds('2026-02-01T00:00:00Z'),
      current_end: seconds('2026-03-01T00:00:00Z'),
      paid_count: 2,
    });
    // chamber-seat-1 is Rs 499 per seat: 3 seats → 1,497 rupees.
    expect(charged.payload.payment?.entity).toMatchObject({
      status: 'captured',
      amount: 149_700,
      method: 'upi',
      email: 'advocate@example.com',
    });

    const failed = await provider.simulate(created.id, 'payment.failed');
    expect(failed.payload.subscription?.entity.status).toBe('pending');
    expect(failed.payload.payment?.entity).toMatchObject({
      status: 'failed',
      error_code: 'BAD_REQUEST_ERROR',
    });

    const halted = await provider.simulate(created.id, 'subscription.halted');
    expect(halted.payload.subscription?.entity.status).toBe('halted');
    expect(halted.contains).toEqual(['subscription']);

    const cancelled = await provider.simulate(created.id, 'subscription.cancelled');
    expect(cancelled.payload.subscription?.entity.status).toBe('cancelled');
    expect(await provider.fetchSubscription(created.id)).toMatchObject({
      status: 'cancelled',
      mandate: { state: 'cancelled' },
    });

    expect(provider.deliveries().map((d) => [d.eventId, d.body.event])).toEqual([
      ['evt_mock_0001', 'subscription.activated'],
      ['evt_mock_0002', 'subscription.charged'],
      ['evt_mock_0003', 'payment.failed'],
      ['evt_mock_0004', 'subscription.halted'],
      ['evt_mock_0005', 'subscription.cancelled'],
    ]);
  });

  it('recovers from a failed payment when the retry charges', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    await provider.simulate(id, 'payment.failed');
    const charged = await provider.simulate(id, 'subscription.charged');
    expect(charged.payload.subscription?.entity.status).toBe('active');
  });

  it('simulates every declared event', () => {
    expect(SIMULATED_EVENTS).toEqual([
      'subscription.charged',
      'payment.failed',
      'subscription.halted',
      'subscription.cancelled',
    ]);
  });
});

describe('determinism', () => {
  async function script() {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    await provider.simulate(id, 'subscription.charged');
    await provider.simulate(id, 'payment.failed');
    return { subscription: await provider.fetchSubscription(id), log: provider.deliveries() };
  }

  it('returns deep-equal results from fresh instances', async () => {
    expect(await script()).toEqual(await script());
  });

  it('uses the injected clock', async () => {
    const provider = createMockBillingProvider({ now: () => new Date('2028-01-31T00:00:00Z') });
    const id = await active(provider);
    expect((await provider.fetchSubscription(id)).currentEnd).toEqual(
      new Date('2028-02-29T00:00:00Z'),
    );
  });

  it('defaults to a fixed epoch', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    expect((await provider.fetchSubscription(id)).currentStart).toEqual(MOCK_EPOCH);
  });

  it('addInterval clamps month ends and handles leap years', () => {
    expect(addInterval(seconds('2026-01-31T00:00:00Z'), 'month')).toBe(
      seconds('2026-02-28T00:00:00Z'),
    );
    expect(addInterval(seconds('2028-02-29T00:00:00Z'), 'year')).toBe(
      seconds('2029-02-28T00:00:00Z'),
    );
    expect(addInterval(seconds('2026-12-15T00:00:00Z'), 'month')).toBe(
      seconds('2027-01-15T00:00:00Z'),
    );
  });
});

describe('subscription operations', () => {
  it('updates the quantity', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    expect((await provider.updateSubscriptionQuantity(id, 5)).quantity).toBe(5);
  });

  it('has no scheduled quantity by default', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    expect((await provider.fetchSubscription(id)).pendingQuantity).toBeNull();
    expect((await provider.updateSubscriptionQuantity(id, 4, { at: 'now' })).pendingQuantity).toBe(
      null,
    );
  });

  it('applies a cycle-end quantity on the next charge', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    await provider.updateSubscriptionQuantity(id, 5);
    const scheduled = await provider.updateSubscriptionQuantity(id, 3, { at: 'cycle_end' });
    expect(scheduled).toMatchObject({ quantity: 5, pendingQuantity: 3 });

    const charged = await provider.simulate(id, 'subscription.charged');
    expect(charged.payload.subscription?.entity).toMatchObject({
      quantity: 3,
      has_scheduled_changes: false,
      change_scheduled_at: null,
    });
    // chamber-seat-1 is 49_900 paise per seat.
    expect(charged.payload.payment?.entity.amount).toBe(3 * 49_900);
    expect(await provider.fetchSubscription(id)).toMatchObject({
      quantity: 3,
      pendingQuantity: null,
    });
  });

  it('resumes a paused subscription only', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    await expect(provider.resume(id)).rejects.toMatchObject({ code: 'invalid_state' });
    const paused = await provider.pause(id);
    const resumed = await provider.resume(id);
    expect(resumed).toMatchObject({ status: 'active', mandate: { state: 'active' } });
    expect(resumed.chargeAt).toEqual(paused.currentEnd);
  });

  it('pauses an active subscription and its mandate', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    expect(await provider.pause(id)).toMatchObject({
      status: 'paused',
      chargeAt: null,
      mandate: { state: 'paused' },
    });
  });

  it('cancels at cycle end without ending the period', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    const result = await provider.cancelSubscription(id, { atCycleEnd: true });
    expect(result).toMatchObject({ status: 'active', cancelAtCycleEnd: true });
    await expect(provider.simulate(id, 'subscription.charged')).rejects.toMatchObject({
      code: 'invalid_state',
    });
    expect((await provider.simulate(id, 'subscription.cancelled')).event).toBe(
      'subscription.cancelled',
    );
  });

  it('cancels immediately', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    expect(await provider.cancelSubscription(id, { atCycleEnd: false })).toMatchObject({
      status: 'cancelled',
      cancelAtCycleEnd: false,
      chargeAt: null,
    });
  });

  it('tracks UPI mandate states', async () => {
    const provider = createMockBillingProvider();
    const subscription = await subscribed(provider);
    expect((await provider.setMandateState(subscription.id, 'failed')).mandate?.state).toBe(
      'failed',
    );
    await expect(provider.authorizeMandate(subscription.id)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    // A fresh link restarts the authorisation.
    expect((await provider.createMandateLink(subscription.id)).status).toBe('created');
    await provider.authorizeMandate(subscription.id);
    expect((await provider.fetchSubscription(subscription.id)).mandate?.state).toBe('active');
    await expect(provider.createMandateLink(subscription.id)).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });
});

describe('errors', () => {
  it('rejects unknown ids with not_found', async () => {
    const provider = createMockBillingProvider();
    await expect(provider.fetchSubscription('sub_missing')).rejects.toBeInstanceOf(
      BillingProviderError,
    );
    await expect(provider.fetchSubscription('sub_missing')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      provider.createSubscription({ customerId: 'cust_missing', planId: 'p', quantity: 1 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects illegal transitions with invalid_state', async () => {
    const provider = createMockBillingProvider();
    const created = await subscribed(provider);
    await expect(provider.simulate(created.id, 'payment.failed')).rejects.toMatchObject({
      code: 'invalid_state',
    });
    await expect(provider.pause(created.id)).rejects.toMatchObject({ code: 'invalid_state' });

    await provider.cancelSubscription(created.id, { atCycleEnd: false });
    await expect(provider.updateSubscriptionQuantity(created.id, 4)).rejects.toMatchObject({
      code: 'invalid_state',
    });
    await expect(provider.simulate(created.id, 'subscription.charged')).rejects.toMatchObject({
      code: 'invalid_state',
    });
  });

  it('rejects invalid quantities', async () => {
    const provider = createMockBillingProvider();
    await expect(subscribed(provider, 0)).rejects.toMatchObject({ code: 'invalid_input' });
    const id = await active(provider);
    await expect(provider.updateSubscriptionQuantity(id, 1.5)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});

describe('plan changes, cancellation withdrawal and adoption (#257)', () => {
  it('switches the plan and quantity now', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    const result = await provider.updateSubscriptionPlan(id, {
      planId: 'chamber-seat-2',
      quantity: 4,
      at: 'now',
    });
    expect(result).toMatchObject({ planId: 'chamber-seat-2', quantity: 4, pendingQuantity: null });
    const charged = await provider.simulate(id, 'subscription.charged');
    // chamber-seat-2 is 64_900 paise per seat.
    expect(charged.payload.payment?.entity.amount).toBe(4 * 64_900);
  });

  it('schedules a plan for the next cycle', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    const scheduled = await provider.updateSubscriptionPlan(id, {
      planId: 'chamber-seat-2',
      quantity: 3,
      at: 'cycle_end',
    });
    expect(scheduled.planId).toBe('chamber-seat-1');
    const charged = await provider.simulate(id, 'subscription.charged');
    expect(charged.payload.subscription?.entity).toMatchObject({
      plan_id: 'chamber-seat-2',
      has_scheduled_changes: false,
    });
  });

  it('rejects a plan change on an ended subscription', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    await provider.cancelSubscription(id, { atCycleEnd: false });
    await expect(
      provider.updateSubscriptionPlan(id, { planId: 'chamber-seat-2', quantity: 3, at: 'now' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('withdraws a scheduled cancellation, and only one', async () => {
    const provider = createMockBillingProvider();
    const id = await active(provider);
    await expect(provider.withdrawCancellation(id)).rejects.toBeInstanceOf(BillingProviderError);
    await provider.cancelSubscription(id, { atCycleEnd: true });
    expect((await provider.withdrawCancellation(id)).cancelAtCycleEnd).toBe(false);
  });

  it('adopts a subscription known only to the database, idempotently', async () => {
    const provider = createMockBillingProvider();
    const input = {
      id: 'sub_e2e_ws',
      customerId: 'cust_e2e_ws',
      planId: 'chamber-seat-1',
      quantity: 3,
      status: 'active' as const,
      currentStart: MOCK_EPOCH,
      currentEnd: new Date('2026-02-01T00:00:00Z'),
      cancelAtCycleEnd: false,
    };
    const adopted = await provider.adoptSubscription(input);
    expect(adopted).toMatchObject({ id: 'sub_e2e_ws', status: 'active', quantity: 3 });
    await provider.updateSubscriptionQuantity('sub_e2e_ws', 5);
    const again = await provider.adoptSubscription({ ...input, quantity: 9 });
    expect(again.quantity).toBe(5);
    await provider.cancelSubscription('sub_e2e_ws', { atCycleEnd: true });
    expect((await provider.withdrawCancellation('sub_e2e_ws')).cancelAtCycleEnd).toBe(false);
  });
});
