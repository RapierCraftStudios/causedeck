// `notification.deliver` (#196, #23; spike §1, §2): sends one email or push for one in-app
// notification. `notify()` (`@causedeck/notifications`) writes the row and enqueues this job per
// enabled instant channel after commit, with ids only. The job re-reads the row, the recipient and
// their preference inside the payload's workspace, then:
// - skips (and records why) a recipient who left, turned the channel off, or is on the email
//   suppression list; the transport is never called for a suppressed address;
// - sends once per (notification, channel): the singleton key stops duplicate jobs and `once()`
//   stops a redelivered job from sending again;
// - records a permanent failure (e.g. SES `MessageRejected`) as `failed` and completes, so it is
//   never retried or re-sent; any other failure throws `RetryableError`, which rolls back the
//   `once()` claim, and pg-boss retries with backoff.
// The outcome is written to `notification.data.delivery.<channel>` on the existing row; the job
// never inserts a notification. Push is disabled until #197 provides a sender. Logs carry ids,
// status and error codes only, never the address, title or body.
import { serverEnv } from '@causedeck/config/env';
import { schema } from '@causedeck/db';
import {
  getPreferences,
  isCategoryKey,
  NotificationError,
  type NotificationContext,
} from '@causedeck/notifications';
import {
  createEmailTransport,
  emailErrorCode,
  isPermanentEmailError,
  isSuppressed,
  preferencesUrl,
  renderEmail,
  toEmailLocale,
  type EmailTransport,
  type RenderedEmail,
} from '@causedeck/notifications/email';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { once } from '../idempotency.ts';

const { notification, user } = schema;

export const DELIVERY_CHANNELS = ['email', 'push'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const notificationDeliverSchema = z.object({
  workspaceId: workspaceIdSchema,
  notificationId: z.uuid(),
  channel: z.enum(DELIVERY_CHANNELS),
});

export type NotificationDeliverPayload = z.output<typeof notificationDeliverSchema>;

/** What the push channel needs from #197; content stays minimal (no body). */
export interface PushSender {
  send(push: { userId: string; category: string; title: string; href: string }): Promise<void>;
}

/** Transports and links the notification jobs use; injectable for tests. */
export interface NotificationJobDeps {
  email: EmailTransport;
  /** Absent: push is disabled and recorded as skipped. */
  push?: PushSender | undefined;
  appUrl: string;
  now?: () => Date;
}

let override: NotificationJobDeps | null = null;
let defaults: NotificationJobDeps | undefined;

/** Test hook and wiring point: replace the env-built transports (`null` restores them). */
export function setNotificationJobDeps(deps: NotificationJobDeps | null): void {
  override = deps;
}

/** The deps the job handlers use: the override, else built once from the server env. */
export function notificationJobDeps(log: JobContext['log']): NotificationJobDeps {
  if (override !== null) return override;
  if (defaults === undefined) {
    const env = serverEnv();
    defaults = { email: createEmailTransport(env, log), appUrl: env.APP_URL };
  }
  return defaults;
}

export type DeliveryStatus = 'sent' | 'failed' | 'skipped';
export type DeliverOutcome = DeliveryStatus | 'missing' | 'already_delivered';

export interface DeliveryRecord {
  status: DeliveryStatus;
  reason?: string;
  code?: string;
  at: string;
}

/** Write the channel's outcome under `data.delivery` on the existing row. */
async function record(
  ctx: Pick<JobContext, 'db'>,
  { notificationId, channel }: NotificationDeliverPayload,
  entry: DeliveryRecord,
): Promise<void> {
  const value = JSON.stringify({ [channel]: entry });
  await ctx.db
    .update(notification)
    .set({
      data: sql`jsonb_set(${notification.data}, '{delivery}', coalesce(${notification.data} -> 'delivery', '{}'::jsonb) || ${value}::jsonb)`,
    })
    .where(eq(notification.id, notificationId));
}

/** Absolute app link for a stored same-origin path. */
export function appLink(appUrl: string, href: string | null | undefined): string {
  return new URL(href ?? '/', appUrl).toString();
}

async function renderFor(
  row: { category: string; title: string; body: string | null; href: string | null },
  locale: string,
  appUrl: string,
): Promise<RenderedEmail> {
  const href = appLink(appUrl, row.href);
  const props = { title: row.title, body: row.body ?? undefined, href };
  const lang = toEmailLocale(locale);
  if (row.category === 'security.alert') return renderEmail('security-alert', props, lang);
  const prefs = preferencesUrl(appUrl);
  if (row.category === 'billing.notice') {
    return renderEmail('billing-notice', { ...props, preferencesUrl: prefs }, lang);
  }
  return renderEmail('notice', { ...props, preferencesUrl: prefs }, lang);
}

/** Is `channel` still on and instant for the member? `null` when they are no longer a member. */
async function channelEnabled(
  ctx: NotificationContext,
  userId: string,
  category: string,
  channel: DeliveryChannel,
): Promise<boolean | null> {
  try {
    const prefs = await getPreferences(ctx, { userId });
    if (!isCategoryKey(category)) return false;
    const pref = prefs.find((p) => p.category === category && p.channel === channel);
    return pref !== undefined && pref.enabled && pref.digest === 'instant';
  } catch (error) {
    if (error instanceof NotificationError && error.code === 'FORBIDDEN') return null;
    throw error;
  }
}

/** Deliver one notification on one channel. Exported for tests. */
export async function runNotificationDeliver(
  ctx: JobContext,
  payload: NotificationDeliverPayload,
  deps: NotificationJobDeps = notificationJobDeps(ctx.log),
): Promise<DeliverOutcome> {
  const { workspaceId, notificationId, channel } = payload;
  const at = () => (deps.now?.() ?? new Date()).toISOString();
  const fields = { workspaceId, notificationId, channel };

  const [row] = await ctx.db
    .select({
      userId: notification.userId,
      category: notification.category,
      title: notification.title,
      body: notification.body,
      href: notification.href,
    })
    .from(notification)
    .where(and(eq(notification.id, notificationId), eq(notification.workspaceId, workspaceId)));
  if (!row) {
    ctx.log.warn(fields, 'notification not found; nothing to deliver');
    return 'missing';
  }

  const skip = async (reason: string): Promise<DeliverOutcome> => {
    await record(ctx, payload, { status: 'skipped', reason, at: at() });
    ctx.log.info({ ...fields, status: 'skipped', reason }, 'notification delivery skipped');
    return 'skipped';
  };

  const enabled = await channelEnabled(
    { db: ctx.db, workspaceId },
    row.userId,
    row.category,
    channel,
  );
  if (enabled === null) return skip('not_member');
  if (!enabled) return skip('disabled');

  let send: () => Promise<void>;
  if (channel === 'email') {
    const [recipient] = await ctx.db
      .select({ email: user.email, locale: user.locale })
      .from(user)
      .where(eq(user.id, row.userId));
    if (!recipient) return skip('not_member');
    if (await isSuppressed(ctx.db, recipient.email)) return skip('suppressed');
    const email = await renderFor(row, recipient.locale, deps.appUrl);
    send = async () => {
      await deps.email.send({ to: recipient.email, ...email, tags: { category: row.category } });
    };
  } else {
    const push = deps.push;
    if (push === undefined) return skip('push_disabled');
    send = () =>
      push.send({
        userId: row.userId,
        category: row.category,
        title: row.title,
        href: appLink(deps.appUrl, row.href),
      });
  }

  const result = await once(ctx, ctx.idempotencyKey, async (): Promise<DeliveryRecord> => {
    try {
      await send();
      return { status: 'sent', at: at() };
    } catch (error) {
      const code = emailErrorCode(error);
      if (channel === 'email' && isPermanentEmailError(error)) {
        return { status: 'failed', code, at: at() };
      }
      throw new RetryableError(
        'NOTIFICATION_DELIVERY_RETRY',
        `delivery failed (${code}); will retry`,
      );
    }
  });
  if (result.skipped) return 'already_delivered';

  await record(ctx, payload, result.value);
  if (result.value.status === 'failed') {
    ctx.log.warn(
      { ...fields, status: 'failed', code: result.value.code },
      'notification delivery failed permanently',
    );
  } else {
    ctx.log.info({ ...fields, status: 'sent' }, 'notification delivered');
  }
  return result.value.status;
}

/** One job per notification and channel; also the `once()` key. */
export const deliveryKey = (p: Pick<NotificationDeliverPayload, 'notificationId' | 'channel'>) =>
  `${p.notificationId}:${p.channel}`;

export const notificationDeliver = defineJob({
  name: 'notification.deliver',
  schema: notificationDeliverSchema,
  retry: { limit: 5, delaySec: 30, backoff: true, delayMaxSec: 3600 },
  singleton: { key: deliveryKey },
  idempotencyKey: deliveryKey,
  handler: async (ctx, payload) => {
    await runNotificationDeliver(ctx, payload);
  },
});
