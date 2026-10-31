// The free tier's fetch cost budget (#506). A free workspace (one advocate on the Junior plan) has a
// monthly IST cap on the spend of its delegated lookups, counted in micro-dollars as the
// `fetch.cost_micros` usage key. `admit` is asked before each lookup and says no once the month's
// spend plus the per-lookup ceiling would pass the cap; `record` adds what a lookup cost, at most
// once per fetch. A paid plan has no allowance and is never capped. Only ids and numbers are stored.
import {
  fetchCostMicros,
  freeAlertsLimitsFor,
  FREE_ALERTS_PLAN_LIMITS,
  type FreeAlertsLimits,
} from '@causedeck/billing';
import { withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { isEnabled } from '@causedeck/flags';

import { getWorkspaceEntitlements } from '../billing/index.ts';
import { getUsage, increment } from '../usage/index.ts';

type Db = Database | Transaction;

export const FREE_ALERTS_FLAG = 'growth.free-alerts';
export const FETCH_COST_KEY = 'fetch.cost_micros' as const;

/** Where the budget reads and writes: the usage meter in production, a fake in tests. */
export interface FetchBudgetStore {
  /** The workspace's allowance, or null when its plan is not free. */
  limits(workspaceId: string, now: Date): Promise<Readonly<FreeAlertsLimits> | null>;
  /** The workspace's micro-dollars spent in the IST month of `now`. */
  spent(workspaceId: string, now: Date): Promise<number>;
  /** Add `micros` once per `idempotencyKey`. */
  add(workspaceId: string, micros: number, idempotencyKey: string, now: Date): Promise<void>;
}

export interface FreeAlertsDeps {
  db: Db;
  now?: () => Date;
  /** The flag; defaults to `growth.free-alerts` for the workspace. */
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
  store?: FetchBudgetStore;
  /** The allowance table by plan id; defaults to the billing data. */
  planLimits?: Readonly<Record<string, Readonly<FreeAlertsLimits>>>;
}

/** The store over the usage meter and the workspace's entitlements. */
export function usageBudgetStore(
  db: Db,
  planLimits: Readonly<Record<string, Readonly<FreeAlertsLimits>>> = FREE_ALERTS_PLAN_LIMITS,
): FetchBudgetStore {
  return {
    limits: (workspaceId, now) =>
      withWorkspace(db, { workspaceId }, async (tx) => {
        const entitlements = await getWorkspaceEntitlements(tx, workspaceId, now);
        return freeAlertsLimitsFor(entitlements.planId, planLimits);
      }),
    spent: (workspaceId, now) =>
      getUsage({ db, workspaceId, now: () => now }, FETCH_COST_KEY).catch(() => 0),
    add: async (workspaceId, micros, idempotencyKey, now) => {
      await increment({ db, workspaceId, now: () => now }, FETCH_COST_KEY, micros, {
        idempotencyKey,
      });
    },
  };
}

export const flagOf = (deps: FreeAlertsDeps) => (workspaceId: string) =>
  (deps.flagEnabled ?? ((id: string) => isEnabled(FREE_ALERTS_FLAG, { workspaceId: id })))(
    workspaceId,
  );

export const storeOf = (deps: FreeAlertsDeps): FetchBudgetStore =>
  deps.store ?? usageBudgetStore(deps.db, deps.planLimits);

export const nowOf = (deps: FreeAlertsDeps): Date => deps.now?.() ?? new Date();

export interface FetchBudget {
  /** False when the workspace is not on the free tier or the flag is off: no cap applies. */
  capped: boolean;
  limits: Readonly<FreeAlertsLimits> | null;
  spentMicros: number;
  /** Micro-dollars left under the cap, or null when uncapped. */
  remainingMicros: number | null;
}

/** The workspace's free-tier fetch budget now. */
export async function getFetchBudget(
  deps: FreeAlertsDeps,
  workspaceId: string,
): Promise<FetchBudget> {
  const uncapped: FetchBudget = {
    capped: false,
    limits: null,
    spentMicros: 0,
    remainingMicros: null,
  };
  if (!(await flagOf(deps)(workspaceId))) return uncapped;
  const now = nowOf(deps);
  const store = storeOf(deps);
  const limits = await store.limits(workspaceId, now);
  if (limits === null) return uncapped;
  const spentMicros = await store.spent(workspaceId, now);
  return {
    capped: true,
    limits,
    spentMicros,
    remainingMicros: Math.max(limits.fetchCostCapMicrosPerMonth - spentMicros, 0),
  };
}

/**
 * May one more delegated lookup run for this workspace? A free workspace may when this month's
 * spend plus the per-lookup ceiling fits the cap; anyone else always may.
 */
export async function admitLookup(deps: FreeAlertsDeps, workspaceId: string): Promise<boolean> {
  const budget = await getFetchBudget(deps, workspaceId);
  if (!budget.capped || budget.limits === null) return true;
  return (
    budget.spentMicros + budget.limits.fetchCostCeilingMicros <=
    budget.limits.fetchCostCapMicrosPerMonth
  );
}

/** Count a lookup's cost against the month (a free workspace only); `fetchKey` makes a replay count once. */
export async function recordFetchCost(
  deps: FreeAlertsDeps,
  workspaceId: string,
  costDollars: number,
  fetchKey: string,
): Promise<number> {
  const budget = await getFetchBudget(deps, workspaceId);
  if (!budget.capped || budget.limits === null) return 0;
  const micros = fetchCostMicros(costDollars, budget.limits.fetchCostFloorMicros);
  await storeOf(deps).add(workspaceId, micros, `fetch:${fetchKey}`.slice(0, 200), nowOf(deps));
  return micros;
}
