import { describe, expect, it, vi } from 'vitest';

import {
  checkEntitled,
  createEntitlementCache,
  createEntitlements,
  deriveEntitlements,
  ENTITLEMENT_KEYS,
  EntitlementError,
  type WorkspaceEntitlements,
} from '../entitlements';
import type { SubscriptionRowLike, SubscriptionSnapshot } from '../state-machine';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const DAY_MS = 86_400_000;

function snapshot(over: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    state: 'active',
    planId: 'chamber-seat-1',
    seats: 3,
    clerkSeats: 1,
    currentPeriodStart: new Date('2026-03-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-04-01T00:00:00.000Z'),
    graceUntil: null,
    cancelAtPeriodEnd: false,
    pendingSeats: null,
    providerSubscriptionId: 'sub_1',
    providerCustomerId: 'cust_1',
    ...over,
  };
}

function row(over: Partial<SubscriptionRowLike> = {}): SubscriptionRowLike {
  return {
    status: 'active',
    planId: 'chamber-seat-1',
    seats: 3,
    clerkSeats: 1,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    graceUntil: null,
    cancelAtPeriodEnd: false,
    providerSubscriptionId: 'sub_1',
    providerCustomerId: 'cust_1',
    ...over,
  };
}

const derive = (subscription: SubscriptionSnapshot | null) =>
  deriveEntitlements({ subscription, now: NOW });

function expectExceeded(fn: () => unknown, key: string, limit: number, requested: number) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EntitlementError);
    expect(error).toMatchObject({ code: 'ENTITLEMENT_EXCEEDED', key, limit, requested });
    return;
  }
  throw new Error('expected ENTITLEMENT_EXCEEDED');
}

describe('deriveEntitlements', () => {
  it('puts a workspace without a paid subscription on Junior with fair-use caps', () => {
    expect(derive(null)).toEqual({
      planId: 'junior',
      source: 'junior',
      readOnly: false,
      max_active_matters: 15,
      seats: 1,
      clerk_seats: 0,
      ai_budget_paise: 5_000,
      capture_minutes: 300,
      features: { write: true },
    });
  });

  it('exposes every documented key', () => {
    expect(ENTITLEMENT_KEYS).toEqual(
      expect.arrayContaining([
        'max_active_matters',
        'seats',
        'clerk_seats',
        'ai_budget_paise',
        'features.write',
      ]),
    );
  });

  it('treats a cancelled subscription or an unknown plan as Junior', () => {
    expect(derive(snapshot({ state: 'cancelled' })).source).toBe('junior');
    expect(derive(snapshot({ planId: 'retired-plan' })).source).toBe('junior');
  });

  it('grants chamber purchased seats and clerk seats, at least the 3-seat minimum', () => {
    const e = derive(snapshot({ seats: 5, clerkSeats: 2 }));
    expect(e).toMatchObject({ planId: 'chamber-seat-1', seats: 5, clerk_seats: 2 });
    expect(e.max_active_matters).toBeNull();
    expect(derive(snapshot({ seats: 1, clerkSeats: 0 })).seats).toBe(3);
  });

  it('grants a solo advocate plan unlimited matters, one seat and no clerk seat', () => {
    const e = derive(snapshot({ planId: 'advocate-monthly-1', seats: 4, clerkSeats: 2 }));
    expect(e).toMatchObject({ max_active_matters: null, seats: 1, clerk_seats: 0 });
  });

  it.each(['created', 'active', 'paused', 'past_due'] as const)('%s keeps the plan', (state) => {
    expect(derive(snapshot({ state })).source).toBe('plan');
  });

  it('keeps full access during grace and drops to read-only Junior after it', () => {
    const within = derive(
      snapshot({ state: 'grace', graceUntil: new Date(NOW.getTime() + DAY_MS) }),
    );
    expect(within).toMatchObject({ source: 'plan', readOnly: false, seats: 3 });

    const beyond = derive(
      snapshot({ state: 'grace', graceUntil: new Date(NOW.getTime() - DAY_MS) }),
    );
    expect(beyond).toMatchObject({
      source: 'downgraded',
      readOnly: true,
      planId: 'junior',
      max_active_matters: 15,
      seats: 1,
      features: { write: false },
    });
    expect(derive(snapshot({ state: 'downgraded' }))).toEqual(beyond);
  });
});

describe('checkEntitled', () => {
  const junior = derive(null);

  it('blocks creating matters beyond the Junior limit with ENTITLEMENT_EXCEEDED', () => {
    expect(() => {
      checkEntitled(junior, 'max_active_matters', 15);
    }).not.toThrow();
    expectExceeded(
      () => {
        checkEntitled(junior, 'max_active_matters', 16);
      },
      'max_active_matters',
      15,
      16,
    );
  });

  it('treats null limits as unlimited', () => {
    const chamber = derive(snapshot());
    expect(() => {
      checkEntitled(chamber, 'max_active_matters', 10_000);
    }).not.toThrow();
  });

  it('blocks a disabled feature', () => {
    const readOnly = derive(snapshot({ state: 'downgraded' }));
    expect(() => {
      checkEntitled(junior, 'features.write');
    }).not.toThrow();
    expectExceeded(
      () => {
        checkEntitled(readOnly, 'features.write');
      },
      'features.write',
      0,
      1,
    );
  });

  it('distinguishes clerk seats from other seats', () => {
    const chamber = derive(snapshot({ seats: 3, clerkSeats: 1 }));
    expect(() => {
      checkEntitled(chamber, 'seats', 3);
    }).not.toThrow();
    expectExceeded(
      () => {
        checkEntitled(chamber, 'seats', 4);
      },
      'seats',
      3,
      4,
    );
    expectExceeded(
      () => {
        checkEntitled(chamber, 'clerk_seats', 2);
      },
      'clerk_seats',
      1,
      2,
    );
  });
});

describe('createEntitlements', () => {
  it('serves cached entitlements and sees a change on the next request after invalidate', async () => {
    let current: SubscriptionRowLike | null = null;
    const loadSubscription = vi.fn(() => Promise.resolve(current));
    const service = createEntitlements({ loadSubscription, now: () => NOW });

    expect((await service.getEntitlements('w1')).planId).toBe('junior');
    current = row({ seats: 6 });
    expect((await service.getEntitlements('w1')).planId).toBe('junior');
    expect(loadSubscription).toHaveBeenCalledTimes(1);

    // Webhook processing (#204) applies the event, then invalidates.
    service.invalidate('w1');
    const next: WorkspaceEntitlements = await service.getEntitlements('w1');
    expect(next).toMatchObject({ planId: 'chamber-seat-1', seats: 6 });
    // #30 budgets read the same entitlements.
    expect(next.ai_budget_paise).toBeNull();
  });

  it('assertEntitled rejects with the typed error', async () => {
    const service = createEntitlements({
      loadSubscription: () => Promise.resolve(null),
      now: () => NOW,
    });
    await expect(
      service.assertEntitled({ workspaceId: 'w1' }, 'max_active_matters', 15),
    ).resolves.toBeUndefined();
    await expect(
      service.assertEntitled({ workspaceId: 'w1' }, 'max_active_matters', 16),
    ).rejects.toMatchObject({ code: 'ENTITLEMENT_EXCEEDED', key: 'max_active_matters' });
  });

  it('maps a past_due row with grace_until beyond it to read-only', async () => {
    const service = createEntitlements({
      loadSubscription: () =>
        Promise.resolve(row({ status: 'past_due', graceUntil: new Date(NOW.getTime() - 1) })),
      now: () => NOW,
    });
    expect(await service.getEntitlements('w1')).toMatchObject({ readOnly: true });
  });
});

describe('createEntitlementCache', () => {
  it('expires entries after the ttl', async () => {
    let clock = 0;
    const cache = createEntitlementCache({ ttlMs: 10, now: () => clock });
    const load = vi.fn(() => Promise.resolve(derive(null)));
    await cache.get('w', load);
    await cache.get('w', load);
    clock = 11;
    await cache.get('w', load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
