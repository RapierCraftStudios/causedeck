// Web Push subscriptions (#197). `push_subscription` is a global, per-user table without RLS, so
// every function here filters by the authenticated caller's user id: a user can only add, list or
// revoke their own subscriptions. An endpoint belongs to one browser profile, so subscribing an
// endpoint again (also after another user signed in on that browser) re-binds it to the caller.
import { schema, type Queryable } from '@causedeck/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { invalid } from '../errors.ts';

const { pushSubscription } = schema;

const uuid = z.uuid();

/** A browser `PushSubscription.toJSON()`; unknown fields (e.g. `expirationTime`) are dropped. */
export const pushSubscriptionInput = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
});

export type PushSubscriptionInput = z.output<typeof pushSubscriptionInput>;

export const pushUnsubscribeInput = z.object({ endpoint: z.string().min(1).max(2048) });

export interface ActiveSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function userIdOf(userId: string): string {
  if (!uuid.safeParse(userId).success) throw invalid('userId must be a uuid');
  return userId;
}

/** Store (or re-activate) the caller's subscription for this endpoint. */
export async function saveSubscription(
  db: Queryable,
  userId: string,
  input: unknown,
  userAgent?: string | null,
): Promise<{ id: string }> {
  const owner = userIdOf(userId);
  const parsed = pushSubscriptionInput.safeParse(input);
  if (!parsed.success) throw invalid('invalid push subscription');
  const { endpoint, keys } = parsed.data;
  const values = {
    userId: owner,
    p256dh: keys.p256dh,
    auth: keys.auth,
    userAgent: userAgent?.slice(0, 512) ?? null,
  };
  const [row] = await db
    .insert(pushSubscription)
    .values({ endpoint, ...values })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: { ...values, revokedAt: null },
    })
    .returning({ id: pushSubscription.id });
  if (!row) throw new Error('push subscription upsert returned no row');
  return row;
}

/** Revoke the caller's subscription for `endpoint`; `false` when they have no active one. */
export async function revokeSubscription(
  db: Queryable,
  userId: string,
  endpoint: string,
): Promise<boolean> {
  const rows = await db
    .update(pushSubscription)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(pushSubscription.userId, userIdOf(userId)),
        eq(pushSubscription.endpoint, endpoint),
        isNull(pushSubscription.revokedAt),
      ),
    )
    .returning({ id: pushSubscription.id });
  return rows.length > 0;
}

/** The user's subscriptions that have not been revoked. */
export async function activeSubscriptions(
  db: Queryable,
  userId: string,
): Promise<ActiveSubscription[]> {
  return db
    .select({
      id: pushSubscription.id,
      endpoint: pushSubscription.endpoint,
      p256dh: pushSubscription.p256dh,
      auth: pushSubscription.auth,
    })
    .from(pushSubscription)
    .where(and(eq(pushSubscription.userId, userIdOf(userId)), isNull(pushSubscription.revokedAt)));
}
