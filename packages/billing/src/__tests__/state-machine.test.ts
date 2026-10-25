import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SUBSCRIPTION_STATUSES } from '../plans';
import { createMockBillingProvider, type RazorpayWebhookEvent } from '../provider';
import {
  applyProviderEvent,
  fromProviderEvent,
  fromSubscriptionRow,
  GRACE_PERIOD_DAYS,
  IllegalTransitionError,
  SUBSCRIPTION_EVENT_TYPES,
  SUBSCRIPTION_STATES,
  TERMINAL_STATES,
  toSubscriptionStatus,
  transition,
  TRANSITIONS,
  type SubscriptionEvent,
  type SubscriptionEventType,
  type SubscriptionSnapshot,
  type SubscriptionState,
} from '../state-machine';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const DAY_MS = 86_400_000;
const PERIOD_START = new Date('2026-03-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-04-01T00:00:00.000Z');

function snapshot(over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return Object.freeze({
    state: 'active',
    planId: 'chamber-seat-1',
    seats: 3,
    clerkSeats: 1,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    pendingSeats: null,
    providerSubscriptionId: 'sub_mock_0001',
    providerCustomerId: 'cust_mock_0001',
    ...over,
  });
}

/** A representative event of each type. */
function sample(type: SubscriptionEventType): SubscriptionEvent {
  switch (type) {
    case 'activated':
    case 'charged':
      return { type, periodStart: PERIOD_START, periodEnd: PERIOD_END };
    case 'seats_changed':
      return { type, effective: 'now', seats: 4, clerkSeats: 1 };
    case 'plan_changed':
      return { type, planId: 'chamber-seat-2' };
    case 'cancel_requested':
      return { type, atPeriodEnd: true };
    default:
      return { type };
  }
}

/** A snapshot in `state` on which `type` is well-formed (grace already over for grace_expired). */
function stateFor(state: SubscriptionState): SubscriptionSnapshot {
  return snapshot({
    state,
    graceUntil: state === 'grace' ? new Date(NOW.getTime() - 1) : null,
  });
}

const PAIRS = SUBSCRIPTION_STATES.flatMap((state) =>
  SUBSCRIPTION_EVENT_TYPES.map((type) => [state, type] as const),
);

describe('transition table', () => {
  it('lists every state and only known events', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...SUBSCRIPTION_STATES].sort());
    for (const moves of Object.values(TRANSITIONS)) {
      for (const event of Object.keys(moves)) {
        expect(SUBSCRIPTION_EVENT_TYPES).toContain(event);
      }
    }
  });

  it.each(PAIRS)('%s + %s follows the table or throws', (state, type) => {
    const expected = TRANSITIONS[state][type];
    const run = () => transition(stateFor(state), sample(type), NOW);
    if (expected === undefined) {
      expect(run).toThrow(IllegalTransitionError);
      try {
        run();
      } catch (error) {
        expect(error).toMatchObject({ code: 'ILLEGAL_TRANSITION', from: state, event: type });
      }
    } else {
      expect(run().state).toBe(expected);
    }
  });

  it('makes cancelled and downgraded terminal', () => {
    expect(TERMINAL_STATES).toEqual(['cancelled', 'downgraded']);
    for (const state of TERMINAL_STATES) expect(TRANSITIONS[state]).toEqual({});
  });
});

describe('lifecycle', () => {
  it('walks created -> active -> past_due -> grace -> downgraded', () => {
    let s = snapshot({ state: 'created', currentPeriodStart: null, currentPeriodEnd: null });
    s = transition(s, { type: 'activated', periodStart: PERIOD_START, periodEnd: PERIOD_END }, NOW);
    expect(s).toMatchObject({ state: 'active', currentPeriodEnd: PERIOD_END });
    s = transition(s, { type: 'payment_failed' }, NOW);
    expect(s.state).toBe('past_due');
    s = transition(s, { type: 'payment_failed' }, NOW);
    s = transition(s, { type: 'halted' }, NOW);
    expect(s.state).toBe('grace');
    expect(s.graceUntil).toEqual(new Date(NOW.getTime() + GRACE_PERIOD_DAYS * DAY_MS));

    const early = new Date(NOW.getTime() + GRACE_PERIOD_DAYS * DAY_MS - 1);
    expect(() => transition(s, { type: 'grace_expired' }, early)).toThrow(IllegalTransitionError);
    const graceUntil = s.graceUntil ?? NOW;
    s = transition(s, { type: 'grace_expired' }, graceUntil);
    expect(s.state).toBe('downgraded');
    expect(() => transition(s, sample('charged'), NOW)).toThrow(IllegalTransitionError);
  });

  it.each(['past_due', 'grace'] as const)('recovers from %s on a charge', (state) => {
    const next = transition(
      snapshot({ state, graceUntil: new Date(NOW.getTime() + DAY_MS) }),
      { type: 'charged', periodStart: PERIOD_END, periodEnd: new Date('2026-05-01T00:00:00Z') },
      NOW,
    );
    expect(next).toMatchObject({
      state: 'active',
      graceUntil: null,
      currentPeriodStart: PERIOD_END,
    });
  });

  it('pauses and resumes', () => {
    const paused = transition(snapshot(), { type: 'paused' }, NOW);
    expect(paused.state).toBe('paused');
    expect(() => transition(paused, sample('seats_changed'), NOW)).toThrow(IllegalTransitionError);
    expect(transition(paused, { type: 'resumed' }, NOW).state).toBe('active');
  });

  it('cancels at period end, then ends on the next charge', () => {
    const requested = transition(snapshot(), { type: 'cancel_requested', atPeriodEnd: true }, NOW);
    expect(requested).toMatchObject({ state: 'active', cancelAtPeriodEnd: true });
    expect(transition(requested, { type: 'cancel_withdrawn' }, NOW).cancelAtPeriodEnd).toBe(false);
    expect(transition(requested, sample('charged'), NOW)).toMatchObject({
      state: 'cancelled',
      cancelAtPeriodEnd: false,
    });
  });

  it('cancels immediately', () => {
    for (const state of ['created', 'paused'] as const) {
      expect(
        transition(snapshot({ state }), { type: 'cancel_requested', atPeriodEnd: false }, NOW)
          .state,
      ).toBe('cancelled');
    }
    expect(transition(snapshot(), { type: 'completed' }, NOW).state).toBe('cancelled');
  });
});

describe('seat and plan changes', () => {
  it('applies a change now', () => {
    const next = transition(
      snapshot({ pendingSeats: { seats: 3, clerkSeats: 0 } }),
      { type: 'seats_changed', effective: 'now', seats: 5, clerkSeats: 2 },
      NOW,
    );
    expect(next).toMatchObject({ seats: 5, clerkSeats: 2, pendingSeats: null });
  });

  it('schedules a decrease for the period end and applies it on the next charge', () => {
    const scheduled = transition(
      snapshot({ seats: 5 }),
      { type: 'seats_changed', effective: 'period_end', seats: 3, clerkSeats: 0 },
      NOW,
    );
    expect(scheduled).toMatchObject({
      seats: 5,
      clerkSeats: 1,
      pendingSeats: { seats: 3, clerkSeats: 0 },
    });
    const charged = transition(
      scheduled,
      { ...sample('charged'), quantity: 5 } as SubscriptionEvent,
      NOW,
    );
    expect(charged).toMatchObject({ seats: 3, clerkSeats: 0, pendingSeats: null });
  });

  it('takes the provider quantity on a charge without a scheduled change', () => {
    const next = transition(
      snapshot(),
      { ...sample('charged'), quantity: 7 } as SubscriptionEvent,
      NOW,
    );
    expect(next.seats).toBe(7);
  });

  it('rejects invalid seat counts', () => {
    expect(() =>
      transition(
        snapshot(),
        { type: 'seats_changed', effective: 'now', seats: 0, clerkSeats: 0 },
        NOW,
      ),
    ).toThrow(RangeError);
    expect(() =>
      transition(
        snapshot(),
        { type: 'seats_changed', effective: 'now', seats: 2, clerkSeats: -1 },
        NOW,
      ),
    ).toThrow(RangeError);
  });

  it('changes the plan', () => {
    expect(
      transition(snapshot(), { type: 'plan_changed', planId: 'chamber-seat-3' }, NOW).planId,
    ).toBe('chamber-seat-3');
    expect(() => transition(snapshot(), { type: 'plan_changed', planId: '' }, NOW)).toThrow(
      RangeError,
    );
  });

  it('is pure: never mutates its input and returns a frozen snapshot', () => {
    const input = snapshot();
    const copy = structuredClone(input);
    const next = transition(input, sample('seats_changed'), NOW);
    expect(input).toEqual(copy);
    expect(next).not.toBe(input);
    expect(Object.isFrozen(next)).toBe(true);
  });
});

describe('provider events', () => {
  const DIR = join(import.meta.dirname, '../__fixtures__/razorpay');
  const webhooks = readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { entity?: string })
    .filter((body) => body.entity === 'event') as RazorpayWebhookEvent[];

  const EXPECTED: Record<string, SubscriptionEventType> = {
    'subscription.activated': 'activated',
    'subscription.charged': 'charged',
    'payment.failed': 'payment_failed',
    'subscription.halted': 'halted',
    'subscription.cancelled': 'cancelled',
    'subscription.paused': 'paused',
  };

  it('maps every recorded webhook fixture', () => {
    expect(webhooks.map((b) => b.event).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const body of webhooks) {
      expect(fromProviderEvent(body)?.type).toBe(EXPECTED[body.event]);
    }
  });

  it('reads the period and quantity from a charge', () => {
    const charged = webhooks.find((b) => b.event === 'subscription.charged');
    expect(charged && fromProviderEvent(charged)).toEqual({
      type: 'charged',
      periodStart: new Date(1_769_904_000_000),
      periodEnd: new Date(1_772_323_200_000),
      quantity: 3,
    });
  });

  it.each([
    ['subscription.pending', 'payment_failed'],
    ['subscription.resumed', 'resumed'],
    ['subscription.completed', 'completed'],
  ] as const)('maps %s', (event, type) => {
    expect(fromProviderEvent({ ...webhooks[0], event } as RazorpayWebhookEvent)?.type).toBe(type);
  });

  it('ignores payment.captured and unknown events', () => {
    const s = snapshot();
    for (const event of ['payment.captured', 'invoice.paid']) {
      const body = { ...webhooks[0], event } as RazorpayWebhookEvent;
      expect(fromProviderEvent(body)).toBeNull();
      expect(applyProviderEvent(s, body, NOW)).toBe(s);
    }
  });

  it('follows the mock provider through a dunning flow', async () => {
    const provider = createMockBillingProvider();
    const customer = await provider.createCustomer({ email: 'advocate@example.com' });
    const sub = await provider.createSubscription({
      customerId: customer.id,
      planId: 'chamber-seat-1',
      quantity: 3,
    });
    let s = snapshot({
      state: 'created',
      clerkSeats: 0,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      providerSubscriptionId: sub.id,
    });
    s = applyProviderEvent(s, await provider.authorizeMandate(sub.id), NOW);
    expect(s).toMatchObject({ state: 'active', seats: 3 });
    s = applyProviderEvent(s, await provider.simulate(sub.id, 'payment.failed'), NOW);
    expect(s.state).toBe('past_due');
    s = applyProviderEvent(s, await provider.simulate(sub.id, 'subscription.halted'), NOW);
    expect(s.state).toBe('grace');
    s = applyProviderEvent(s, await provider.simulate(sub.id, 'subscription.charged'), NOW);
    expect(s).toMatchObject({ state: 'active', graceUntil: null });
    s = applyProviderEvent(s, await provider.simulate(sub.id, 'subscription.cancelled'), NOW);
    expect(s.state).toBe('cancelled');
  });

  it('throws on an illegal provider event', () => {
    const body = webhooks.find((b) => b.event === 'payment.failed');
    expect(() => body && applyProviderEvent(snapshot({ state: 'paused' }), body, NOW)).toThrow(
      IllegalTransitionError,
    );
  });
});

describe('DB status mapping', () => {
  it.each(SUBSCRIPTION_STATES)('round-trips %s through the subscription row', (state) => {
    const s = snapshot({
      state,
      graceUntil: state === 'grace' ? new Date(NOW.getTime() + DAY_MS) : null,
    });
    const status = toSubscriptionStatus(state);
    expect(SUBSCRIPTION_STATUSES).toContain(status);
    expect(fromSubscriptionRow({ ...s, status })).toEqual(s);
  });

  it('maps the lifecycle names the enum lacks', () => {
    expect(toSubscriptionStatus('created')).toBe('trialing');
    expect(toSubscriptionStatus('grace')).toBe('past_due');
    expect(toSubscriptionStatus('downgraded')).toBe('expired');
  });
});
