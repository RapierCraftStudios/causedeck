// Entitlements (#28 part 4, #203): what a workspace may use, derived from its plan and subscription
// state. Pure and injectable: `@causedeck/db` depends on this package, so the subscription is read
// by the caller (`@causedeck/core/billing`) and passed in through `loadSubscription`.
//
// - No subscription, a cancelled one, or an unknown plan: Junior (15 active matters, fair-use caps,
//   one seat).
// - `created`, `active`, `paused`, `past_due`, and `grace` until `graceUntil`: the plan's limits.
// - `downgraded`, or `grace` after `graceUntil`: read-only Junior limits (`features.write` false).
//   Data is never deleted; only new work is blocked.
//
// Seats: per-seat (chamber) plans grant the purchased `seats` (at least `minSeats`) and
// `clerk_seats`; other plans grant `minSeats` seats and no clerk seat.
import { getPlan, PLAN_CATALOGUE, type Plan } from './plans';
import {
  fromSubscriptionRow,
  type SubscriptionRowLike,
  type SubscriptionSnapshot,
} from './state-machine';

/** Numeric limits; `null` means unlimited. */
export const LIMIT_KEYS = [
  'max_active_matters',
  'seats',
  'clerk_seats',
  'ai_budget_paise',
  'capture_minutes',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = ['write'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type EntitlementKey = LimitKey | `features.${FeatureKey}`;

export const ENTITLEMENT_KEYS: readonly EntitlementKey[] = [
  ...LIMIT_KEYS,
  ...FEATURE_KEYS.map((f) => `features.${f}` as const),
];

export type EntitlementSource = 'plan' | 'junior' | 'downgraded';

export interface WorkspaceEntitlements {
  planId: string;
  source: EntitlementSource;
  /** Beyond grace: existing data stays readable, new work is blocked. */
  readOnly: boolean;
  max_active_matters: number | null;
  seats: number;
  clerk_seats: number;
  /** Monthly AI budget (#30). */
  ai_budget_paise: number | null;
  capture_minutes: number | null;
  features: Record<FeatureKey, boolean>;
}

export const JUNIOR_PLAN_ID = 'junior';

export class EntitlementError extends Error {
  readonly code = 'ENTITLEMENT_EXCEEDED';
  readonly key: EntitlementKey;
  /** The granted limit (`0` for a disabled feature). */
  readonly limit: number;
  readonly requested: number;

  constructor(key: EntitlementKey, limit: number, requested: number) {
    super(`Entitlement ${key} exceeded: ${String(requested)} requested, ${String(limit)} allowed`);
    this.name = 'EntitlementError';
    this.key = key;
    this.limit = limit;
    this.requested = requested;
  }
}

export interface DeriveEntitlementsInput {
  subscription: SubscriptionSnapshot | null;
  now: Date;
  catalogue?: readonly Plan[];
}

function fromPlan(
  plan: Plan,
  source: EntitlementSource,
  seats: { seats: number; clerkSeats: number },
): WorkspaceEntitlements {
  const readOnly = source === 'downgraded';
  return Object.freeze({
    planId: plan.id,
    source,
    readOnly,
    max_active_matters: plan.limits.maxActiveMatters,
    seats: seats.seats,
    clerk_seats: seats.clerkSeats,
    ai_budget_paise: plan.limits.fairUse.aiBudgetPaisePerMonth,
    capture_minutes: plan.limits.fairUse.captureMinutesPerMonth,
    features: Object.freeze({ write: !readOnly }),
  });
}

/** The entitlements for a subscription (or none) at `now`. Pure. */
export function deriveEntitlements(input: DeriveEntitlementsInput): WorkspaceEntitlements {
  const catalogue = input.catalogue ?? PLAN_CATALOGUE;
  const junior = getPlan(JUNIOR_PLAN_ID, catalogue);
  if (!junior) throw new Error('The plan catalogue has no junior plan');
  const juniorSeats = { seats: junior.minSeats, clerkSeats: 0 };

  const sub = input.subscription;
  const plan = sub ? getPlan(sub.planId, catalogue) : undefined;
  if (!sub || !plan || sub.state === 'cancelled') return fromPlan(junior, 'junior', juniorSeats);

  const graceOver =
    sub.state === 'grace' &&
    (sub.graceUntil === null || input.now.getTime() > sub.graceUntil.getTime());
  if (sub.state === 'downgraded' || graceOver) {
    return fromPlan(junior, 'downgraded', juniorSeats);
  }
  return fromPlan(
    plan,
    'plan',
    plan.perSeat
      ? { seats: Math.max(sub.seats, plan.minSeats), clerkSeats: sub.clerkSeats }
      : { seats: plan.minSeats, clerkSeats: 0 },
  );
}

/**
 * Throw `ENTITLEMENT_EXCEEDED` unless the workspace may reach `amount` of `key` (the total after
 * the action: creating the 16th matter is `amount` 16). A `features.*` key throws when disabled.
 */
export function checkEntitled(
  entitlements: WorkspaceEntitlements,
  key: EntitlementKey,
  amount = 1,
): void {
  if (key.startsWith('features.')) {
    const feature = key.slice('features.'.length) as FeatureKey;
    if (!entitlements.features[feature]) throw new EntitlementError(key, 0, amount);
    return;
  }
  const limit = entitlements[key as LimitKey];
  if (limit !== null && amount > limit) throw new EntitlementError(key, limit, amount);
}

export interface EntitlementCache {
  get(
    workspaceId: string,
    load: () => Promise<WorkspaceEntitlements>,
  ): Promise<WorkspaceEntitlements>;
  /** Drop a workspace's entry; webhook processing (#204) calls this after applying an event. */
  invalidate(workspaceId: string): void;
  clear(): void;
}

export interface EntitlementCacheOptions {
  /** Upper bound on staleness across processes that cannot invalidate each other. */
  ttlMs?: number;
  now?: () => number;
}

export function createEntitlementCache(options: EntitlementCacheOptions = {}): EntitlementCache {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, { value: WorkspaceEntitlements; expires: number }>();
  return {
    async get(workspaceId, load) {
      const hit = entries.get(workspaceId);
      if (hit && hit.expires > now()) return hit.value;
      const value = await load();
      entries.set(workspaceId, { value, expires: now() + ttlMs });
      return value;
    },
    invalidate(workspaceId) {
      entries.delete(workspaceId);
    },
    clear() {
      entries.clear();
    },
  };
}

export interface EntitlementsOptions {
  /** The workspace's current subscription row, or `null` when it has none. */
  loadSubscription: (workspaceId: string) => Promise<SubscriptionRowLike | null>;
  now?: () => Date;
  catalogue?: readonly Plan[];
  cache?: EntitlementCache;
}

export interface EntitlementContext {
  workspaceId: string;
}

export interface EntitlementsService {
  getEntitlements(workspaceId: string): Promise<WorkspaceEntitlements>;
  assertEntitled(ctx: EntitlementContext, key: EntitlementKey, amount?: number): Promise<void>;
  invalidate(workspaceId: string): void;
}

export function createEntitlements(options: EntitlementsOptions): EntitlementsService {
  const now = options.now ?? (() => new Date());
  const cache = options.cache ?? createEntitlementCache();

  async function load(workspaceId: string): Promise<WorkspaceEntitlements> {
    const row = await options.loadSubscription(workspaceId);
    return deriveEntitlements({
      subscription: row ? fromSubscriptionRow(row) : null,
      now: now(),
      ...(options.catalogue === undefined ? {} : { catalogue: options.catalogue }),
    });
  }

  const getEntitlements = (workspaceId: string) => cache.get(workspaceId, () => load(workspaceId));

  return {
    getEntitlements,
    async assertEntitled(ctx, key, amount) {
      checkEntitled(await getEntitlements(ctx.workspaceId), key, amount);
    },
    invalidate: (workspaceId) => {
      cache.invalidate(workspaceId);
    },
  };
}
