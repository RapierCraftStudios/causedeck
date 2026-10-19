// The notifications service (#194, #23; spike §2). Notifications go only to active members of the
// workspace about that workspace: every function opens `withWorkspace` for the context workspace and
// first checks that the user is an active member of it (`FORBIDDEN` otherwise). Row-level security
// isolates workspaces; the user filter inside a workspace is applied here. No function takes an
// email address: auth emails (magic link, invitation) are explicit template calls elsewhere.
//
// `notify` writes the in-app row, resolves the member's preferences against the category defaults
// and, after the transaction commits, asks `enqueueDelivery` for one `notification.deliver` job per
// enabled instant email/push channel. The job itself is defined by `@causedeck/core` (#196), which
// depends on this package, so the producer is injected rather than imported.
import { schema, withWorkspace, type Queryable, type Transaction } from '@causedeck/db';
import { and, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  CATEGORIES,
  CATEGORY_KEYS,
  CHANNELS,
  DIGESTS,
  isCategoryKey,
  isLockedChannel,
  type CategoryKey,
  type Channel,
  type Digest,
} from './categories.ts';
import { forbidden, invalid, notFound } from './errors.ts';

const { member, notification, notificationPref, organization } = schema;

export const LIST_LIMIT_MAX = 100;
const LIST_LIMIT_DEFAULT = 50;

/** Where and for which workspace a call runs; the caller has authenticated the user. */
export interface NotificationContext {
  db: Queryable;
  workspaceId: string;
}

/** Payload of the `notification.deliver` job (#196). */
export interface DeliveryJob {
  workspaceId: string;
  notificationId: string;
  channel: Exclude<Channel, 'in_app'>;
}

export interface NotifyContext extends NotificationContext {
  /** Sends one `notification.deliver` job; called after the in-app row is committed. */
  enqueueDelivery: (job: DeliveryJob) => Promise<unknown>;
}

export interface NotifyInput {
  userId: string;
  category: CategoryKey;
  title: string;
  body?: string;
  href?: string;
  dedupeKey?: string;
}

export interface NotificationItem {
  id: string;
  category: string;
  title: string;
  body: string | null;
  href: string | null;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface ResolvedPreference {
  category: CategoryKey;
  channel: Channel;
  enabled: boolean;
  digest: Digest;
  /** Mandatory: the member cannot turn it off. */
  locked: boolean;
}

const uuid = z.uuid();
const category = z.string().refine(isCategoryKey, 'unknown notification category');
/** A same-origin deep link (`/w/slug/...`), never an absolute or protocol-relative URL. */
const href = z
  .string()
  .max(2048)
  .regex(/^\/(?![/\\])/, 'href must be an app path starting with /');

const notifySchema = z.strictObject({
  userId: uuid,
  category,
  title: z.string().trim().min(1).max(200),
  body: z.string().max(2000).optional(),
  href: href.optional(),
  dedupeKey: z.string().min(1).max(200).optional(),
});

const userSchema = z.strictObject({ userId: uuid });

const listSchema = z.strictObject({
  userId: uuid,
  limit: z.number().int().min(1).max(LIST_LIMIT_MAX).optional(),
  before: z.date().optional(),
});

const markReadSchema = z.strictObject({ userId: uuid, notificationId: z.string() });

const setPreferenceSchema = z.strictObject({
  userId: uuid,
  category,
  channel: z.enum(CHANNELS),
  enabled: z.boolean().optional(),
  digest: z.enum(DIGESTS).optional(),
});

function parse<S extends z.ZodType>(s: S, input: unknown): z.output<S> {
  const result = s.safeParse(input);
  if (!result.success) {
    throw invalid(result.error.issues.map((i) => i.message).join('; '));
  }
  return result.data;
}

/** Run `fn` in the context workspace after checking that `userId` is an active member of it. */
async function asMember<T>(
  ctx: NotificationContext,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!uuid.safeParse(ctx.workspaceId).success) throw invalid('workspaceId must be a uuid');
  return withWorkspace(ctx.db, { workspaceId: ctx.workspaceId, userId }, async (tx) => {
    const [row] = await tx
      .select({ id: member.id })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(member.organizationId, ctx.workspaceId),
          eq(member.userId, userId),
          eq(member.status, 'active'),
          isNull(organization.deletedAt),
        ),
      );
    if (!row) throw forbidden();
    return fn(tx);
  });
}

type PrefRow = Pick<
  typeof notificationPref.$inferSelect,
  'category' | 'channel' | 'enabled' | 'digest'
>;

function resolve(key: CategoryKey, channel: Channel, rows: readonly PrefRow[]): ResolvedPreference {
  if (isLockedChannel(key, channel)) {
    return { category: key, channel, enabled: true, digest: 'instant', locked: true };
  }
  const row = rows.find((r) => r.category === key && r.channel === channel);
  const defaults = CATEGORIES[key].defaultChannels as readonly Channel[];
  return {
    category: key,
    channel,
    enabled: row?.enabled ?? defaults.includes(channel),
    digest: row?.digest ?? 'instant',
    locked: false,
  };
}

async function prefRows(tx: Transaction, workspaceId: string, userId: string): Promise<PrefRow[]> {
  return tx
    .select({
      category: notificationPref.category,
      channel: notificationPref.channel,
      enabled: notificationPref.enabled,
      digest: notificationPref.digest,
    })
    .from(notificationPref)
    .where(and(eq(notificationPref.workspaceId, workspaceId), eq(notificationPref.userId, userId)));
}

/** Categories whose in-app channel the member has on; others are hidden from the list and count. */
function visibleCategories(rows: readonly PrefRow[]): CategoryKey[] {
  return CATEGORY_KEYS.filter((key) => resolve(key, 'in_app', rows).enabled);
}

/**
 * Notify one member of the context workspace. Writes the in-app row and enqueues a delivery per
 * enabled instant email/push channel. A repeated `dedupeKey` for the same member writes nothing
 * and enqueues nothing. A non-member (or suspended member) is `FORBIDDEN`.
 */
export async function notify(ctx: NotifyContext, input: NotifyInput): Promise<void> {
  const n = parse(notifySchema, input);
  const key = n.category;
  const created = await asMember(ctx, n.userId, async (tx) => {
    const values = {
      workspaceId: ctx.workspaceId,
      userId: n.userId,
      category: key,
      title: n.title,
      body: n.body ?? null,
      href: n.href ?? null,
      dedupeKey: n.dedupeKey ?? null,
      // Wall-clock, not transaction start: several notifications in one transaction keep their order.
      createdAt: sql`clock_timestamp()`,
    };
    const insert = tx.insert(notification).values(values);
    const rows = await (
      n.dedupeKey === undefined
        ? insert
        : insert.onConflictDoNothing({
            target: [notification.workspaceId, notification.userId, notification.dedupeKey],
            where: sql`dedupe_key is not null`,
          })
    ).returning({ id: notification.id });
    const row = rows[0];
    if (row === undefined) return undefined;
    const prefs = await prefRows(tx, ctx.workspaceId, n.userId);
    const channels = (['email', 'push'] as const).filter((channel) => {
      const p = resolve(key, channel, prefs);
      return p.enabled && p.digest === 'instant';
    });
    return { id: row.id, channels };
  });
  if (created === undefined) return;
  for (const channel of created.channels) {
    await ctx.enqueueDelivery({
      workspaceId: ctx.workspaceId,
      notificationId: created.id,
      channel,
    });
  }
}

/** The member's own notifications, newest first; `before` pages by `createdAt`. */
export async function listForUser(
  ctx: NotificationContext,
  input: { userId: string; limit?: number; before?: Date },
): Promise<NotificationItem[]> {
  const { userId, limit, before } = parse(listSchema, input);
  return asMember(ctx, userId, async (tx) => {
    const visible = visibleCategories(await prefRows(tx, ctx.workspaceId, userId));
    if (visible.length === 0) return [];
    return tx
      .select({
        id: notification.id,
        category: notification.category,
        title: notification.title,
        body: notification.body,
        href: notification.href,
        data: notification.data,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      })
      .from(notification)
      .where(
        and(
          eq(notification.workspaceId, ctx.workspaceId),
          eq(notification.userId, userId),
          inArray(notification.category, visible),
          before === undefined ? undefined : lt(notification.createdAt, before),
        ),
      )
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(limit ?? LIST_LIMIT_DEFAULT);
  });
}

/** Mark one of the member's notifications read; anything else is `NOT_FOUND`. */
export async function markRead(
  ctx: NotificationContext,
  input: { userId: string; notificationId: string },
): Promise<void> {
  const { userId, notificationId } = parse(markReadSchema, input);
  await asMember(ctx, userId, async (tx) => {
    if (!uuid.safeParse(notificationId).success) throw notFound();
    const rows = await tx
      .update(notification)
      .set({ readAt: sql`coalesce(${notification.readAt}, now())` })
      .where(
        and(
          eq(notification.id, notificationId),
          eq(notification.workspaceId, ctx.workspaceId),
          eq(notification.userId, userId),
        ),
      )
      .returning({ id: notification.id });
    if (rows.length === 0) throw notFound();
  });
}

/** Mark all of the member's unread notifications read; returns how many changed. */
export async function markAllRead(
  ctx: NotificationContext,
  input: { userId: string },
): Promise<number> {
  const { userId } = parse(userSchema, input);
  return asMember(ctx, userId, async (tx) => {
    const rows = await tx
      .update(notification)
      .set({ readAt: sql`now()` })
      .where(
        and(
          eq(notification.workspaceId, ctx.workspaceId),
          eq(notification.userId, userId),
          isNull(notification.readAt),
        ),
      )
      .returning({ id: notification.id });
    return rows.length;
  });
}

/** Unread notifications the member can see in-app. */
export async function unreadCount(
  ctx: NotificationContext,
  input: { userId: string },
): Promise<number> {
  const { userId } = parse(userSchema, input);
  return asMember(ctx, userId, async (tx) => {
    const visible = visibleCategories(await prefRows(tx, ctx.workspaceId, userId));
    if (visible.length === 0) return 0;
    const [row] = await tx
      .select({ n: count() })
      .from(notification)
      .where(
        and(
          eq(notification.workspaceId, ctx.workspaceId),
          eq(notification.userId, userId),
          isNull(notification.readAt),
          inArray(notification.category, visible),
        ),
      );
    return row?.n ?? 0;
  });
}

/** The full category × channel matrix for the member, defaults filled in. */
export async function getPreferences(
  ctx: NotificationContext,
  input: { userId: string },
): Promise<ResolvedPreference[]> {
  const { userId } = parse(userSchema, input);
  return asMember(ctx, userId, async (tx) => {
    const rows = await prefRows(tx, ctx.workspaceId, userId);
    return CATEGORY_KEYS.flatMap((key) => CHANNELS.map((channel) => resolve(key, channel, rows)));
  });
}

/**
 * Set one category/channel preference. A locked (mandatory) channel cannot be disabled or moved off
 * instant delivery (`VALIDATION`).
 */
export async function setPreference(
  ctx: NotificationContext,
  input: {
    userId: string;
    category: CategoryKey;
    channel: Channel;
    enabled?: boolean;
    digest?: Digest;
  },
): Promise<ResolvedPreference> {
  const p = parse(setPreferenceSchema, input);
  const key = p.category;
  if (
    isLockedChannel(key, p.channel) &&
    (p.enabled === false || (p.digest ?? 'instant') !== 'instant')
  ) {
    throw invalid(`${key} cannot be turned off for ${p.channel}`);
  }
  return asMember(ctx, p.userId, async (tx) => {
    const current = resolve(key, p.channel, await prefRows(tx, ctx.workspaceId, p.userId));
    const enabled = p.enabled ?? current.enabled;
    const digest = p.digest ?? current.digest;
    await tx
      .insert(notificationPref)
      .values({
        workspaceId: ctx.workspaceId,
        userId: p.userId,
        category: key,
        channel: p.channel,
        enabled,
        digest,
      })
      .onConflictDoUpdate({
        target: [
          notificationPref.workspaceId,
          notificationPref.userId,
          notificationPref.category,
          notificationPref.channel,
        ],
        set: { enabled, digest, updatedAt: new Date() },
      });
    return resolve(key, p.channel, [{ category: key, channel: p.channel, enabled, digest }]);
  });
}
