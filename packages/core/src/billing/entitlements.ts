// Billing entitlements on the database (#203). `@causedeck/billing` is pure (`@causedeck/db`
// depends on it), so this adapter reads the workspace's subscription and hands it to the billing
// derivation. `installBillingEntitlements` replaces the permissive v1 seat gate in
// `../workspaces/members.ts` with one that counts seats against the plan.
//
// Every read runs on the caller's queryable: subscription rows are workspace-isolated (RLS), so
// callers pass their workspace-scoped transaction.
import {
  checkEntitled,
  createEntitlementCache,
  deriveEntitlements,
  fromSubscriptionRow,
  type EntitlementKey,
  type WorkspaceEntitlements,
} from '@causedeck/billing';
import {
  SUBSCRIPTION_STATUSES,
  TERMINAL_SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from '@causedeck/billing/plans';
import { schema, type Database, type Transaction } from '@causedeck/db';
import { desc, eq, sql } from 'drizzle-orm';

import { countBillableSeats, setEntitlements, type Entitlements } from '../workspaces/members.ts';

type Queryable = Database | Transaction;

const { subscription } = schema;

const terminal = sql.raw(TERMINAL_SUBSCRIPTION_STATUSES.map((s) => `'${s}'`).join(', '));

/**
 * The workspace's current subscription: the live one, else the most recent ended one (an `expired`
 * row is a downgrade), else `null`.
 */
export async function loadSubscription(db: Queryable, workspaceId: string) {
  const [row] = await db
    .select()
    .from(subscription)
    .where(eq(subscription.workspaceId, workspaceId))
    .orderBy(
      sql`case when ${subscription.status} in (${terminal}) then 1 else 0 end`,
      desc(subscription.createdAt),
    )
    .limit(1);
  return row ?? null;
}

const isStatus = (status: string): status is SubscriptionStatus =>
  (SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

async function freshEntitlements(db: Queryable, workspaceId: string, now: Date) {
  const row = await loadSubscription(db, workspaceId);
  // The column check (`subscription_status_chk`) only admits known statuses.
  const subscription =
    row && isStatus(row.status) ? fromSubscriptionRow({ ...row, status: row.status }) : null;
  return deriveEntitlements({ subscription, now });
}

const cache = createEntitlementCache();

/** The workspace's entitlements, cached per process until invalidated (or the cache ttl). */
export function getWorkspaceEntitlements(
  db: Queryable,
  workspaceId: string,
  now: Date = new Date(),
): Promise<WorkspaceEntitlements> {
  return cache.get(workspaceId, () => freshEntitlements(db, workspaceId, now));
}

/** Throw `ENTITLEMENT_EXCEEDED` unless the workspace may reach `amount` of `key`. */
export async function assertEntitled(
  db: Queryable,
  ctx: { workspaceId: string },
  key: EntitlementKey,
  amount?: number,
): Promise<void> {
  checkEntitled(await getWorkspaceEntitlements(db, ctx.workspaceId), key, amount);
}

/** Drop the cached entitlements; billing webhook processing (#204) calls this after each event. */
export function invalidateEntitlements(workspaceId: string): void {
  cache.invalidate(workspaceId);
}

/**
 * The seat gate. Reads the subscription fresh (it runs inside the invite or accept transaction),
 * and counts clerk seats apart from the rest.
 */
export const billingEntitlements: Entitlements = {
  async assertCanAddSeat(db, workspaceId, role) {
    const [entitlements, seats] = await Promise.all([
      freshEntitlements(db, workspaceId, new Date()),
      countBillableSeats(db, workspaceId),
    ]);
    if (role === 'clerk') checkEntitled(entitlements, 'clerk_seats', seats.clerk + 1);
    else checkEntitled(entitlements, 'seats', seats.nonClerk + 1);
  },
};

/** Install the billing seat gate (idempotent). */
export function installBillingEntitlements(): void {
  setEntitlements(billingEntitlements);
}
