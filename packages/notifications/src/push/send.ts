// Web Push delivery (#197, #23; spike §1). `notification.deliver` (#196) calls `PushSender.send`
// once per notification; it sends a VAPID-signed push to each of the member's active
// subscriptions. A 404 or 410 from the push service means the subscription is gone: it is revoked
// and never tried again. Other failures are transient: if no subscription received the push, the
// sender throws and the job retries with backoff. Logs carry ids and status codes only, never the
// endpoint, title or body.
import { schema, type Queryable } from '@causedeck/db';
import { eq } from 'drizzle-orm';
import webpush from 'web-push';

import { buildPushPayload } from './payload.ts';
import { activeSubscriptions } from './subscribe.ts';
import { pushConfig, vapidDetails, type PushEnv } from './vapid.ts';

const { pushSubscription } = schema;

/** One notification to push; content is reduced by `buildPushPayload`. */
export interface PushMessage {
  notificationId: string;
  userId: string;
  category: string;
  title: string;
  body: string | null;
  /** Absolute app link. */
  href: string;
  /** The member's `Show details on lock screen` setting. */
  showDetails: boolean;
}

export interface PushResult {
  /** Subscriptions the push service accepted the push for. */
  delivered: number;
  /** Subscriptions revoked on 404/410. */
  revoked: number;
  /** Subscriptions that failed transiently. */
  failed: number;
}

/** What `notification.deliver` needs from the push channel. */
export interface PushSender {
  send(message: PushMessage, db: Queryable): Promise<PushResult>;
}

/** The `web-push` call the sender makes; stubbed in tests. */
export interface WebPushClient {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: {
      TTL: number;
      urgency?: 'very-low' | 'low' | 'normal' | 'high';
      vapidDetails: { subject: string; publicKey: string; privateKey: string };
    },
  ): Promise<unknown>;
}

export interface PushLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/** Thrown when no subscription received the push and at least one failed transiently. */
export class PushDeliveryError extends Error {
  constructor(readonly statusCodes: readonly (number | undefined)[]) {
    super(`push failed for every subscription (${statusCodes.map(String).join(', ')})`);
    this.name = 'PushDeliveryError';
  }
}

/** A push service response meaning the subscription no longer exists. */
export function isGoneStatus(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    return typeof statusCode === 'number' ? statusCode : undefined;
  }
  return undefined;
}

/** A day: a push older than that is no longer useful. */
const TTL_SECONDS = 24 * 60 * 60;

export interface PushSenderOptions {
  env: PushEnv;
  log?: PushLogger | undefined;
  client?: WebPushClient | undefined;
}

/** The env-configured sender, or `undefined` when VAPID keys are absent (push disabled). */
export function createPushSender({
  env,
  log,
  client = webpush,
}: PushSenderOptions): PushSender | undefined {
  const config = pushConfig(env);
  if (config === null) return undefined;
  const details = vapidDetails(config);
  return {
    async send(message, db) {
      const payload = JSON.stringify(buildPushPayload(message));
      const urgency = message.category === 'security.alert' ? 'high' : 'normal';
      const result: PushResult = { delivered: 0, revoked: 0, failed: 0 };
      const failures: (number | undefined)[] = [];
      for (const sub of await activeSubscriptions(db, message.userId)) {
        try {
          await client.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: TTL_SECONDS, urgency, vapidDetails: details },
          );
          result.delivered += 1;
          await db
            .update(pushSubscription)
            .set({ lastUsedAt: new Date() })
            .where(eq(pushSubscription.id, sub.id));
        } catch (error) {
          const status = statusOf(error);
          if (isGoneStatus(status)) {
            result.revoked += 1;
            await db
              .update(pushSubscription)
              .set({ revokedAt: new Date() })
              .where(eq(pushSubscription.id, sub.id));
            log?.info({ subscriptionId: sub.id, status }, 'push subscription gone; revoked');
          } else {
            result.failed += 1;
            failures.push(status);
            log?.warn({ subscriptionId: sub.id, status }, 'push send failed');
          }
        }
      }
      if (result.delivered === 0 && result.failed > 0) throw new PushDeliveryError(failures);
      return result;
    },
  };
}
