// `POST /v1/webhooks/razorpay` (#28 part 5, #204). Public: Razorpay authenticates by signing the
// raw body (`X-Razorpay-Signature`, HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET`, or the mock secret
// in dev and CI). The handler only verifies, stores and queues, so it answers fast:
//
// 1. Read the raw body before parsing; a missing or wrong signature is a 400.
// 2. A missing `x-razorpay-event-id`, unparseable JSON or a `created_at` outside the replay window
//    is a 400.
// 3. The workspace comes only from the stored provider subscription id (never from notes or other
//    payload metadata). An unknown subscription is acknowledged and ignored.
// 4. The minimised event is stored once per event id in `billing_event`; a replay is a 200 with no
//    side effects. A new event enqueues `billing.process-event` (ids only) in the same transaction.
//
// Logs carry the event id, type and workspace id only: never the body, signature or secret.
import type { RazorpayWebhookEvent } from '@causedeck/billing/provider';
import {
  hashWebhookBody,
  isWithinReplayWindow,
  minimiseWebhookEvent,
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  verifyRazorpaySignature,
  type ReplayWindow,
} from '@causedeck/billing/webhook';
import type { Secret } from '@causedeck/config/env';
import { recordBillingEvent, resolveBillingWorkspace } from '@causedeck/core/billing';
import { enqueue, type JobSender } from '@causedeck/core/jobs';
import type { Database } from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import { RazorpayWebhookAckSchema } from '@causedeck/validators/api';

import { ApiError } from '../../errors.ts';
import { createRouter, defineRoute, problemResponses, type AppRouter } from '../../lib/openapi.ts';

export interface RazorpayWebhookDeps {
  db: Database;
  /** `null` when the app was built without billing (tests, OpenAPI export): every call is a 400. */
  webhookSecret: Secret | null;
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Job sender for `billing.process-event`; defaults to the process-wide producer. */
  sender?: JobSender;
  now?: () => Date;
  replayWindow?: ReplayWindow;
  /** The `subscription.provider` value webhooks resolve against. */
  provider?: string;
}

const EVENT_ID = /^[\x21-\x7e]{1,255}$/;

function badRequest(detail: string): ApiError {
  return new ApiError(400, 'VALIDATION', detail);
}

function parseEvent(raw: string): RazorpayWebhookEvent | null {
  try {
    const body: unknown = JSON.parse(raw);
    if (typeof body !== 'object' || body === null) return null;
    const { event, payload } = body as Record<string, unknown>;
    if (typeof event !== 'string' || typeof payload !== 'object' || payload === null) return null;
    return body as RazorpayWebhookEvent;
  } catch {
    return null;
  }
}

export const razorpayWebhookRoute = defineRoute({
  method: 'post',
  path: '/webhooks/razorpay',
  public: true,
  operationId: 'receiveRazorpayWebhook',
  tags: ['Webhooks'],
  summary: 'Razorpay subscription and payment events (signed with X-Razorpay-Signature)',
  responses: {
    200: {
      description: 'Accepted (also for replays and unknown subscriptions)',
      content: { 'application/json': { schema: RazorpayWebhookAckSchema } },
    },
    ...problemResponses(400, 413, 429),
  },
});

export function razorpayWebhookRouter(deps: RazorpayWebhookDeps): AppRouter {
  const { db, webhookSecret, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const provider = deps.provider ?? 'razorpay';

  return createRouter().openapi(razorpayWebhookRoute, async (c) => {
    const raw = await c.req.text();
    const signature = c.req.header(RAZORPAY_SIGNATURE_HEADER);
    if (webhookSecret === null || !verifyRazorpaySignature(raw, signature, webhookSecret)) {
      throw badRequest('The webhook signature is missing or invalid.');
    }
    const eventId = c.req.header(RAZORPAY_EVENT_ID_HEADER);
    if (eventId === undefined || !EVENT_ID.test(eventId)) {
      throw badRequest('The x-razorpay-event-id header is missing or invalid.');
    }
    const body = parseEvent(raw);
    if (body === null) throw badRequest('The webhook body is not a Razorpay event.');
    if (!isWithinReplayWindow(body.created_at, now(), deps.replayWindow)) {
      throw badRequest('The webhook event is outside the replay window.');
    }

    const fields = { providerEventId: eventId, type: body.event };
    const providerSubscriptionId = body.payload.subscription?.entity.id;
    const workspaceId =
      typeof providerSubscriptionId === 'string' && providerSubscriptionId !== ''
        ? await resolveBillingWorkspace(db, provider, providerSubscriptionId)
        : null;
    if (workspaceId === null) {
      logger.warn(fields, 'billing webhook for an unknown subscription ignored');
      return c.json({ received: true as const }, 200);
    }

    const { inserted } = await recordBillingEvent(
      db,
      {
        workspaceId,
        providerEventId: eventId,
        type: body.event,
        payloadHash: hashWebhookBody(raw),
        payload: minimiseWebhookEvent(body),
      },
      async () => {
        await enqueue(
          'billing.process-event',
          { workspaceId, providerEventId: eventId },
          deps.sender ? { sender: deps.sender } : {},
        );
      },
    );
    if (!inserted) {
      logger.info({ ...fields, workspaceId }, 'billing webhook replay ignored');
      return c.json({ received: true as const, duplicate: true }, 200);
    }
    logger.info({ ...fields, workspaceId }, 'billing webhook queued');
    return c.json({ received: true as const }, 200);
  });
}
