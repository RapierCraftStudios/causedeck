// `whatsapp.intake` (#680): downloads one forwarded WhatsApp media message and stores it in the
// linked member's workspace capture inbox. The inbound webhook queues it (ids only) in the same
// transaction that records the message. The body is `runWhatsAppIntake` in the whatsapp-link
// domain. Singleton and idempotent per message; five attempts with exponential backoff, then the
// dead-letter queue (`pnpm worker dlq`, the admin job metrics).
import {
  CAPTURE_JOB_NAMES,
  CAPTURE_JOB_RETRIES,
  CAPTURE_JOB_RETRY_DELAY_SEC,
  type WhatsAppInboundProvider,
} from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import { captureConfigFromProcess, type CaptureJobs } from '../../capture/index.ts';
import {
  runWhatsAppIntake,
  whatsappInboundProviderFromProcess,
  type WhatsAppIntakeOutcome,
} from '../../whatsapp-link/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';
import { enqueueCaptureProcess } from './capture-process.ts';
import { enqueueCaptureScan } from './capture-scan.ts';

export const whatsappIntakeSchema = z.object({
  workspaceId: workspaceIdSchema,
  userId: z.uuid(),
  inboundMessageId: z.uuid(),
});

export type WhatsAppIntakeJobPayload = z.output<typeof whatsappIntakeSchema>;

let defaultStore: ObjectStore | undefined;

/** Send one `whatsapp.intake` job as the registry's `enqueue` does. */
export async function enqueueWhatsAppIntake(payload: WhatsAppIntakeJobPayload): Promise<unknown> {
  const data = whatsappIntakeSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.whatsappIntake, data, {
    singletonKey: `whatsapp-intake:${data.inboundMessageId}`,
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runWhatsAppIntakeJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: WhatsAppIntakeJobPayload,
  deps: {
    provider?: Pick<WhatsAppInboundProvider, 'fetchMedia'> | null;
    store?: ObjectStore;
    jobs?: CaptureJobs;
    now?: () => Date;
  } = {},
): Promise<WhatsAppIntakeOutcome> {
  const provider = deps.provider === undefined ? whatsappInboundProviderFromProcess() : deps.provider;
  if (provider === null) throw new Error('no inbound WhatsApp provider is configured');
  const outcome = await runWhatsAppIntake(
    {
      db: ctx.db,
      store: deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv())),
      provider,
      config: captureConfigFromProcess(),
      jobs: deps.jobs ?? { scan: enqueueCaptureScan, process: enqueueCaptureProcess },
      ...(deps.now === undefined ? {} : { now: deps.now }),
    },
    payload,
  );
  ctx.log.info(
    {
      inboundMessageId: payload.inboundMessageId,
      outcome: outcome.outcome,
      ...(outcome.outcome === 'dropped' ? { reason: outcome.reason } : {}),
    },
    'whatsapp intake',
  );
  return outcome;
}

export const whatsappIntake = defineJob({
  name: CAPTURE_JOB_NAMES.whatsappIntake,
  schema: whatsappIntakeSchema,
  singleton: { key: (payload) => `whatsapp-intake:${payload.inboundMessageId}` },
  idempotencyKey: (payload) => `whatsapp-intake:${payload.inboundMessageId}`,
  concurrency: 2,
  retry: { limit: CAPTURE_JOB_RETRIES, delaySec: CAPTURE_JOB_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runWhatsAppIntakeJob(ctx, payload);
  },
});
