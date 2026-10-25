import { describe, expect, it } from 'vitest';

import {
  DUNNING_HALT_DAY,
  DUNNING_RETRY_DAYS,
  DUNNING_STAGES,
  dunningDedupeKey,
  dunningNoticeCopy,
  planDunning,
  type DunningInput,
} from '../dunning';
import { deriveEntitlements } from '../entitlements';
import { createMockBillingProvider } from '../provider/mock';
import {
  GRACE_PERIOD_DAYS,
  transition,
  type SubscriptionSnapshot,
  type SubscriptionState,
} from '../state-machine';

const DAY_MS = 86_400_000;
const START = new Date('2026-03-01T06:00:00.000Z');
const at = (days: number) => new Date(START.getTime() + days * DAY_MS);

function snapshot(over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    state: 'past_due',
    planId: 'chamber-seat-1',
    seats: 3,
    clerkSeats: 1,
    currentPeriodStart: new Date('2026-02-01T00:00:00.000Z'),
    currentPeriodEnd: START,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    pendingSeats: null,
    providerSubscriptionId: 'sub_1',
    providerCustomerId: 'cust_1',
    ...over,
  };
}

const plan = (over: Partial<DunningInput> & { days: number }) =>
  planDunning({
    snapshot: snapshot(),
    dunningStartedAt: START,
    attempts: 0,
    now: at(over.days),
    ...over,
  });

describe('dunning schedule', () => {
  it('retries on day 1, 3, 5 and 7 and halts on day 8', () => {
    expect(DUNNING_RETRY_DAYS).toEqual([1, 3, 5, 7]);
    expect(DUNNING_HALT_DAY).toBe(8);
    expect(GRACE_PERIOD_DAYS).toBe(7);
  });

  it('sends the payment_failed notice and nothing else before day 1', () => {
    expect(plan({ days: 0 })).toEqual({
      retry: false,
      attempt: null,
      event: null,
      notices: ['payment_failed'],
    });
    expect(plan({ days: 0.99 }).retry).toBe(false);
  });

  it.each([
    [1, 0, 1],
    [3, 1, 2],
    [5, 2, 3],
    [7, 3, 4],
  ])('retries on day %i (after %i attempts) as attempt %i', (days, attempts, attempt) => {
    expect(plan({ days, attempts })).toEqual({
      retry: true,
      attempt,
      event: null,
      notices: ['payment_failed', `retry_${String(attempt)}`],
    });
  });

  it.each([
    [2, 1],
    [4, 2],
    [6, 3],
    [7.5, 4],
  ])('does not retry between retry days (day %d, %i attempts)', (days, attempts) => {
    const result = plan({ days, attempts });
    expect(result.retry).toBe(false);
    expect(result.event).toBeNull();
    expect(result.notices).toEqual(['payment_failed']);
  });

  it('retries once on a late tick, skipping ahead to the latest due attempt', () => {
    expect(plan({ days: 5.5, attempts: 1 })).toMatchObject({ retry: true, attempt: 3 });
  });

  it('halts into grace only after all four retries and day 8', () => {
    expect(plan({ days: 8, attempts: 3 })).toMatchObject({ retry: true, attempt: 4, event: null });
    expect(plan({ days: 7.9, attempts: 4 }).event).toBeNull();
    expect(plan({ days: 8, attempts: 4 })).toEqual({
      retry: false,
      attempt: null,
      event: { type: 'halted' },
      notices: ['payment_failed', 'grace_started'],
    });
  });

  it('keeps full access during grace and downgrades to read-only Junior after it', () => {
    const halted = transition(snapshot(), { type: 'halted' }, at(8));
    expect(halted.state).toBe('grace');
    expect(halted.graceUntil).toEqual(at(8 + GRACE_PERIOD_DAYS));

    const during = planDunning({
      snapshot: halted,
      dunningStartedAt: START,
      attempts: 4,
      now: at(14),
    });
    expect(during).toEqual({
      retry: false,
      attempt: null,
      event: null,
      notices: ['grace_started'],
    });
    const full = deriveEntitlements({ subscription: halted, now: at(14) });
    expect(full.source).toBe('plan');
    expect(full.features.write).toBe(true);
    expect(full.seats).toBe(3);

    const after = planDunning({
      snapshot: halted,
      dunningStartedAt: START,
      attempts: 4,
      now: at(15),
    });
    expect(after).toEqual({
      retry: false,
      attempt: null,
      event: { type: 'grace_expired' },
      notices: ['grace_started', 'downgraded'],
    });
    const downgraded = transition(halted, { type: 'grace_expired' }, at(15));
    expect(downgraded.state).toBe('downgraded');
    const readOnly = deriveEntitlements({ subscription: downgraded, now: at(15) });
    expect(readOnly.source).toBe('downgraded');
    expect(readOnly.features.write).toBe(false);
    expect(readOnly.max_active_matters).toBe(15);
    // The subscription keeps its plan, seats and ids: nothing is deleted.
    expect(downgraded).toMatchObject({
      planId: 'chamber-seat-1',
      seats: 3,
      providerSubscriptionId: 'sub_1',
    });
  });

  it('drives grace started by a provider halt the same way', () => {
    const grace = snapshot({ state: 'grace', graceUntil: at(10) });
    expect(
      planDunning({ snapshot: grace, dunningStartedAt: START, attempts: 1, now: at(9) }).event,
    ).toBeNull();
    expect(
      planDunning({ snapshot: grace, dunningStartedAt: START, attempts: 1, now: at(10) }).event,
    ).toEqual({
      type: 'grace_expired',
    });
  });

  it.each(['created', 'active', 'paused', 'cancelled', 'downgraded'] as SubscriptionState[])(
    'does nothing for %s',
    (state) => {
      expect(plan({ days: 9, snapshot: snapshot({ state }) })).toEqual({
        retry: false,
        attempt: null,
        event: null,
        notices: [],
      });
    },
  );

  it('does nothing without a dunning start', () => {
    expect(plan({ days: 9, dunningStartedAt: null }).notices).toEqual([]);
  });
});

describe('dunning notices', () => {
  it('has a stable, distinct dedupe key per stage and episode', () => {
    const keys = DUNNING_STAGES.map((stage) => dunningDedupeKey('sub-uuid', START, stage));
    expect(new Set(keys).size).toBe(DUNNING_STAGES.length);
    expect(dunningDedupeKey('sub-uuid', START, 'retry_1')).toBe(
      `billing.dunning:sub-uuid:${String(START.getTime())}:retry_1`,
    );
    expect(dunningDedupeKey('sub-uuid', at(30), 'retry_1')).not.toBe(keys[1]);
    for (const key of keys) expect(key.length).toBeLessThanOrEqual(200);
  });

  it('has copy for every stage without amounts', () => {
    for (const stage of DUNNING_STAGES) {
      const copy = dunningNoticeCopy(stage, { planName: 'Chamber' });
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.title.length).toBeLessThanOrEqual(200);
      expect(copy.body).toContain('Chamber');
      expect(`${copy.title} ${copy.body}`).not.toMatch(/Rs|₹|INR|paise|\d{3,}/);
    }
    expect(dunningNoticeCopy('grace_started', { planName: 'Chamber' }).body).toContain(
      'No data is deleted',
    );
    expect(dunningNoticeCopy('downgraded', { planName: 'Chamber' }).body).toContain('read-only');
  });
});

describe('mock provider retryPayment', () => {
  async function pending() {
    const provider = createMockBillingProvider();
    const customer = await provider.createCustomer({ email: 'accounts@example.in' });
    const sub = await provider.createSubscription({
      customerId: customer.id,
      planId: 'chamber-seat-1',
      quantity: 3,
    });
    await provider.authorizeMandate(sub.id);
    await provider.simulate(sub.id, 'payment.failed');
    return { provider, id: sub.id };
  }

  it('fails again by default and raises payment.failed', async () => {
    const { provider, id } = await pending();
    const result = await provider.retryPayment(id);
    expect(result.outcome).toBe('failed');
    expect(result.subscription.status).toBe('pending');
    expect(provider.deliveries().at(-1)?.body.event).toBe('payment.failed');
  });

  it('charges when told to and raises subscription.charged', async () => {
    const { provider, id } = await pending();
    provider.setRetryOutcome(id, 'charged');
    const result = await provider.retryPayment(id);
    expect(result.outcome).toBe('charged');
    expect(result.subscription.status).toBe('active');
    expect(provider.deliveries().at(-1)?.body.event).toBe('subscription.charged');
  });

  it('rejects a retry for an active or unknown subscription', async () => {
    const { provider, id } = await pending();
    provider.setRetryOutcome(id, 'charged');
    await provider.retryPayment(id);
    await expect(provider.retryPayment(id)).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(provider.retryPayment('sub_unknown')).rejects.toMatchObject({ code: 'not_found' });
  });
});
