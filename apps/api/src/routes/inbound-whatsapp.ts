// `POST /v1/inbound/whatsapp` and the `GET` subscription handshake (#680, part 3 of #502), modelled
// on the inbound email webhook (#530). Public: the Meta Cloud API signs the raw body
// (`X-Hub-Signature-256`). The handler only verifies, records and queues:
//
// 1. Read the raw body, then let the provider verify it. A call it rejects is a 400.
// 2. Each media message's sender resolves to one verified link without an oracle. Unknown,
//    unlinked and ambiguous numbers, disallowed types and a workspace whose `whatsapp` channel is
//    off are acknowledged and dropped: only the dropped reason is logged, never the number.
// 3. A new provider message id is stored once per workspace and `whatsapp.intake` (ids only) is
//    queued in the same transaction; a redelivery is a 200 with no side effects.
//
// The media is not downloaded here: `whatsapp.intake` does that.
import { enqueue, type JobSender } from '@causedeck/core/jobs';
import {
  receiveInboundWhatsApp,
  type WhatsAppInboundProvider,
} from '@causedeck/core/whatsapp-link';
import type { Database } from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import { z } from '@hono/zod-openapi';

import { ApiError } from '../errors.ts';
import { createRouter, defineRoute, problemResponses, type AppRouter } from '../lib/openapi.ts';

export interface InboundWhatsAppDeps {
  db: Database;
  /** `null` when none is configured (tests, OpenAPI export): every call is a 400. */
  provider: WhatsAppInboundProvider | null;
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Job sender for `whatsapp.intake`; defaults to the process-wide producer. */
  sender?: JobSender;
  now?: () => Date;
}

const AckSchema = z.object({ received: z.literal(true) }).openapi('InboundWhatsAppAck');

export const inboundWhatsAppRoute = defineRoute({
  method: 'post',
  path: '/inbound/whatsapp',
  public: true,
  operationId: 'receiveInboundWhatsApp',
  tags: ['Inbound'],
  summary: 'Inbound WhatsApp media (Meta Cloud API webhook, signed with the app secret)',
  responses: {
    200: {
      description: 'Accepted (also for duplicates, unknown senders and disabled channels)',
      content: { 'application/json': { schema: AckSchema } },
    },
    ...problemResponses(400, 413, 429),
  },
});

export const inboundWhatsAppChallengeRoute = defineRoute({
  method: 'get',
  path: '/inbound/whatsapp',
  public: true,
  operationId: 'verifyInboundWhatsApp',
  tags: ['Inbound'],
  summary: 'WhatsApp webhook subscription handshake (echoes hub.challenge for the verify token)',
  request: {
    query: z.object({
      'hub.mode': z.string().optional(),
      'hub.verify_token': z.string().optional(),
      'hub.challenge': z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'The challenge, as plain text',
      content: { 'text/plain': { schema: z.string() } },
    },
    ...problemResponses(400, 429),
  },
});

export function inboundWhatsAppRouter(deps: InboundWhatsAppDeps): AppRouter {
  const { db, provider, logger } = deps;
  const now = deps.now ?? (() => new Date());

  return createRouter()
    .openapi(inboundWhatsAppChallengeRoute, (c) => {
      if (provider === null) {
        throw new ApiError(400, 'VALIDATION', 'Inbound WhatsApp is not configured.');
      }
      const query = c.req.valid('query');
      const answer = provider.challenge({
        ...(query['hub.mode'] === undefined ? {} : { mode: query['hub.mode'] }),
        ...(query['hub.verify_token'] === undefined
          ? {}
          : { verifyToken: query['hub.verify_token'] }),
        ...(query['hub.challenge'] === undefined ? {} : { challenge: query['hub.challenge'] }),
      });
      if (answer === null) throw new ApiError(400, 'VALIDATION', 'The handshake was refused.');
      return c.text(answer, 200);
    })
    .openapi(inboundWhatsAppRoute, async (c) => {
      const body = await c.req.text();
      if (provider === null) {
        throw new ApiError(400, 'VALIDATION', 'Inbound WhatsApp is not configured.');
      }
      const headers: Record<string, string> = {};
      c.req.raw.headers.forEach((value, name) => {
        headers[name.toLowerCase()] = value;
      });
      const verified = await provider.verify({ headers, body });
      if (!verified.ok) {
        logger.warn({ reason: verified.reason }, 'inbound whatsapp rejected');
        throw new ApiError(400, 'VALIDATION', 'The notification could not be verified.');
      }

      const counts = { accepted: 0, duplicate: 0, dropped: 0 };
      for (const message of verified.messages) {
        const outcome = await receiveInboundWhatsApp(
          db,
          { message, now: now() },
          async (target) => {
            await enqueue('whatsapp.intake', target, deps.sender ? { sender: deps.sender } : {});
          },
        );
        if (outcome.status === 'dropped') {
          counts.dropped += 1;
          logger.info({ reason: outcome.reason }, 'inbound whatsapp dropped');
        } else {
          counts[outcome.status] += 1;
        }
      }
      logger.info(counts, 'inbound whatsapp received');
      return c.json({ received: true as const }, 200);
    });
}
