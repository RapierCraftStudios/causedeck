import { describe, expect, it } from 'vitest';

import { prorateSeatIncrease } from '../proration';
import {
  createMockBillingProvider,
  MOCK_EPOCH,
  MOCK_MANDATE_BASE_URL,
  type MockBillingProvider,
} from '../provider';
import { applyProviderEvent, BillingServiceError, createBillingService } from '../service';
import { IllegalTransitionError, type SubscriptionSnapshot } from '../state-machine';

const DAY_MS = 86_400_000;

function setup() {
  let clock = MOCK_EPOCH;
  const now = () => clock;
  const provider = createMockBillingProvider({ now });
  const service = createBillingService({ provider, now });
  return {
    provider,
    service,
    advance: (days: number) => {
      clock = new Date(clock.getTime() + days * DAY_MS);
    },
    now,
  };
}

async function activeChamber(
  provider: MockBillingProvider,
  service: ReturnType<typeof createBillingService>,
  now: () => Date,
  seats = 3,
): Promise<SubscriptionSnapshot> {
  const started = await service.startSubscription({
    planId: 'chamber-seat-1',
    seats,
    billingEmail: 'chamber@example.com',
  });
  const id = started.subscription.providerSubscriptionId ?? '';
  return applyProviderEvent(started.subscription, await provider.authorizeMandate(id), now());
}

describe('startSubscription', () => {
  it('creates a customer, a subscription and a UPI Autopay mandate link', async () => {
    const { service, provider } = setup();
    const started = await service.startSubscription({
      planId: 'chamber-seat-1',
      seats: 3,
      clerkSeats: 1,
      billingEmail: 'chamber@example.com',
      customerName: 'Chamber',
    });
    expect(started.subscription).toMatchObject({
      state: 'created',
      planId: 'chamber-seat-1',
      seats: 3,
      clerkSeats: 1,
      providerSubscriptionId: 'sub_mock_0001',
      providerCustomerId: 'cust_mock_0001',
    });
    expect(started.mandateUrl.startsWith(MOCK_MANDATE_BASE_URL)).toBe(true);
    expect(started.charge).toBeNull();
    expect((await provider.fetchSubscription('sub_mock_0001')).quantity).toBe(3);
  });

  it.each([
    ['below the chamber minimum', { planId: 'chamber-seat-1', seats: 2 }],
    ['the free plan', { planId: 'junior', seats: 1 }],
    ['an unknown plan', { planId: 'nope', seats: 1 }],
    ['clerk seats on an advocate plan', { planId: 'advocate-monthly-1', seats: 1, clerkSeats: 1 }],
  ])('rejects %s with INVALID_INPUT', async (_label, input) => {
    const { service, provider } = setup();
    const result = service.startSubscription({ ...input, billingEmail: 'a@example.com' });
    await expect(result).rejects.toBeInstanceOf(BillingServiceError);
    await expect(result).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(provider.deliveries()).toEqual([]);
  });

  it('becomes active once the mandate is authorised', async () => {
    const { service, provider, now } = setup();
    const s = await activeChamber(provider, service, now);
    expect(s).toMatchObject({ state: 'active', currentPeriodStart: MOCK_EPOCH });
  });
});

describe('changeSeats', () => {
  it('prorates an increase mid-cycle and applies it now', async () => {
    const { service, provider, now, advance } = setup();
    const s = await activeChamber(provider, service, now);
    advance(10);
    const result = await service.changeSeats(s, { seats: 5, clerkSeats: 0 });
    expect(result.subscription).toMatchObject({ seats: 5, pendingSeats: null });
    expect(result.provider.quantity).toBe(5);
    expect(result.charge).toEqual(
      prorateSeatIncrease({
        plan: { pricePaise: 49_900, clerkSeatPricePaise: 19_900 },
        from: { seats: 3, clerkSeats: 0 },
        to: { seats: 5, clerkSeats: 0 },
        periodStart: MOCK_EPOCH,
        periodEnd: new Date('2026-02-01T00:00:00Z'),
        at: now(),
      }),
    );
    // 99_800 × 21 / 31 = 67_606.45 → 67_606.
    expect(result.charge?.amountPaise).toBe(67_606);
  });

  it('schedules a decrease for the next cycle', async () => {
    const { service, provider, now, advance } = setup();
    const five = (
      await service.changeSeats(await activeChamber(provider, service, now), {
        seats: 5,
        clerkSeats: 0,
      })
    ).subscription;
    advance(5);
    const result = await service.changeSeats(five, { seats: 3, clerkSeats: 0 });
    expect(result.charge).toBeNull();
    expect(result.subscription).toMatchObject({
      seats: 5,
      pendingSeats: { seats: 3, clerkSeats: 0 },
    });
    expect(result.provider).toMatchObject({ quantity: 5, pendingQuantity: 3 });

    const id = five.providerSubscriptionId ?? '';
    const charged = await provider.simulate(id, 'subscription.charged');
    expect(charged.payload.payment?.entity.amount).toBe(3 * 49_900);
    const next = applyProviderEvent(result.subscription, charged, now());
    expect(next).toMatchObject({ seats: 3, pendingSeats: null, state: 'active' });
  });

  it('applies the rising half of a mixed change now and schedules the rest', async () => {
    const { service, provider, now } = setup();
    const s = await service.changeSeats(await activeChamber(provider, service, now, 4), {
      seats: 4,
      clerkSeats: 2,
    });
    const result = await service.changeSeats(s.subscription, { seats: 3, clerkSeats: 3 });
    expect(result.subscription).toMatchObject({
      seats: 4,
      clerkSeats: 3,
      pendingSeats: { seats: 3, clerkSeats: 3 },
    });
    expect(result.charge?.lines).toEqual([
      expect.objectContaining({ kind: 'seat', quantity: 0 }),
      expect.objectContaining({ kind: 'clerk_seat', quantity: 1, amountPaise: 19_900 }),
    ]);
    expect(result.provider).toMatchObject({ quantity: 4, pendingQuantity: 3 });
  });

  it('rejects counts below the plan minimum without calling the provider', async () => {
    const { service, provider, now } = setup();
    const s = await activeChamber(provider, service, now);
    await expect(service.changeSeats(s, { seats: 2, clerkSeats: 0 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect((await provider.fetchSubscription(s.providerSubscriptionId ?? '')).quantity).toBe(3);
  });

  it('rejects changes in an illegal state before calling the provider', async () => {
    const { service, provider, now } = setup();
    const s = await activeChamber(provider, service, now);
    await provider.pause(s.providerSubscriptionId ?? '');
    const paused = { ...s, state: 'paused' as const };
    await expect(service.changeSeats(paused, { seats: 4, clerkSeats: 0 })).rejects.toBeInstanceOf(
      IllegalTransitionError,
    );
  });
});

describe('cancel and resume', () => {
  it('cancels at period end, then immediately', async () => {
    const { service, provider, now } = setup();
    const s = await activeChamber(provider, service, now);
    const atEnd = await service.cancel(s, { atPeriodEnd: true });
    expect(atEnd.subscription).toMatchObject({ state: 'active', cancelAtPeriodEnd: true });
    expect(atEnd.provider.cancelAtCycleEnd).toBe(true);

    const { service: service2, provider: provider2, now: now2 } = setup();
    const s2 = await activeChamber(provider2, service2, now2);
    const immediate = await service2.cancel(s2, { atPeriodEnd: false });
    expect(immediate.subscription.state).toBe('cancelled');
    expect(immediate.provider.status).toBe('cancelled');
  });

  it('resumes a paused subscription', async () => {
    const { service, provider, now } = setup();
    const s = await activeChamber(provider, service, now);
    await provider.pause(s.providerSubscriptionId ?? '');
    const paused = { ...s, state: 'paused' as const };
    const result = await service.resume(paused);
    expect(result.subscription.state).toBe('active');
    expect(result.provider.status).toBe('active');
  });

  it('refuses to resume anything that is not paused', async () => {
    const { service, provider, now } = setup();
    const s = await activeChamber(provider, service, now);
    await expect(service.resume(s)).rejects.toBeInstanceOf(IllegalTransitionError);
    const cancelling = (await service.cancel(s, { atPeriodEnd: true })).subscription;
    await expect(service.resume(cancelling)).rejects.toBeInstanceOf(IllegalTransitionError);
  });
});
