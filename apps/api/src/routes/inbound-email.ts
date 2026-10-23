// `POST /v1/inbound/email` (#54 part 3, #530). Public: the provider authenticates the call (an SNS
// message signature for Amazon SES, a shared-secret header in dev and CI). Like the Razorpay
// webhook the handler only verifies, records and queues, so it answers well inside 300 ms:
//
// 1. Read the raw body, then let the provider verify it. A call it rejects is a 400.
// 2. Each announced recipient resolves to a workspace without an oracle. An unknown or revoked
//    address and a workspace whose `email` channel is off are acknowledged and dropped: only the
//    dropped reason is logged, never the address or the message.
// 3. A new message id is stored once per workspace and `email.intake` (ids only) is queued in the
//    same transaction; a redelivery is a 200 with no side effects.
//
// The raw message is not fetched or parsed here: `email.intake` does that.
import { enqueue, type JobSender } from '@causedeck/core/jobs';
import { receiveInboundEmail, type InboundEmailProvider } from '@causedeck/core/email-intake';
import type { Database } from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import { z } from '@hono/zod-openapi';

import { ApiError } from '../errors.ts';
import { createRouter, defineRoute, problemResponses, type AppRouter } from '../lib/openapi.ts';

export interface InboundEmailDeps {
  db: Database;
  /** `null` when none is configured (tests, OpenAPI export): every call is a 400. */
  provider: InboundEmailProvider | null;
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Job sender for `email.intake`; defaults to the process-wide producer. */
  sender?: JobSender;
  now?: () => Date;
}

const InboundEmailAckSchema = z.object({ received: z.literal(true) }).openapi('InboundEmailAck');

export const inboundEmailRoute = defineRoute({
  method: 'post',
  path: '/inbound/email',
  public: true,
  operationId: 'receiveInboundEmail',
  tags: ['Inbound'],
  summary: 'Inbound email notifications (SNS-signed for SES, shared secret in dev)',
  responses: {
    200: {
      description: 'Accepted (also for duplicates, unknown addresses and disabled channels)',
      content: { 'application/json': { schema: InboundEmailAckSchema } },
    },
    ...problemResponses(400, 413, 429),
  },
});

export function inboundEmailRouter(deps: InboundEmailDeps): AppRouter {
  const { db, provider, logger } = deps;
  const now = deps.now ?? (() => new Date());

  return createRouter().openapi(inboundEmailRoute, async (c) => {
    const body = await c.req.text();
    if (provider === null)
      throw new ApiError(400, 'VALIDATION', 'Inbound email is not configured.');
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const verified = await provider.verify({ headers, body });
    if (!verified.ok) {
      logger.warn({ reason: verified.reason }, 'inbound email rejected');
      throw new ApiError(400, 'VALIDATION', 'The notification could not be verified.');
    }

    const counts = { accepted: 0, duplicate: 0, dropped: 0 };
    for (const notification of verified.notifications) {
      for (const address of notification.recipients) {
        const outcome = await receiveInboundEmail(
          db,
          {
            address,
            messageId: notification.messageId,
            rawMimeRef: notification.rawRef,
            now: now(),
          },
          async (target) => {
            await enqueue('email.intake', target, deps.sender ? { sender: deps.sender } : {});
          },
        );
        if (outcome.status === 'dropped') {
          counts.dropped += 1;
          logger.info({ reason: outcome.reason }, 'inbound email dropped');
        } else {
          counts[outcome.status] += 1;
        }
      }
    }
    logger.info(counts, 'inbound email received');
    return c.json({ received: true as const }, 200);
  });
}
