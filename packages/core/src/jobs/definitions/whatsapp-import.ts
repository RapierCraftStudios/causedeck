// `whatsapp.import` (#526): structures a received WhatsApp chat (`capture.process` claims the
// capture and queues this job for channel `whatsapp_export`). The body is `runWhatsAppImport` in the
// whatsapp domain. Ids only in the payload; singleton per capture. Five attempts with exponential
// backoff; when they run out the capture is marked `failed` (`processing_failed`).
import {
  CAPTURE_JOB_NAMES,
  CAPTURE_JOB_RETRIES,
  CAPTURE_JOB_RETRY_DELAY_SEC,
} from '@causedeck/capture';
import { db as rootDb } from '@causedeck/db';
import type { ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import type { AiGateway } from '@causedeck/ai';

import { markCaptureFailed } from '../../capture/index.ts';
import { runWhatsAppImport } from '../../whatsapp/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const whatsappImportSchema = z.object({
  workspaceId: workspaceIdSchema,
  captureId: z.uuid(),
});

export type WhatsAppImportJobPayload = z.output<typeof whatsappImportSchema>;

/** Send one `whatsapp.import` job as the registry's `enqueue` does. */
export async function enqueueWhatsAppImport(payload: WhatsAppImportJobPayload): Promise<unknown> {
  const data = whatsappImportSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.whatsappImport, data, {
    singletonKey: `whatsapp-import:${data.captureId}`,
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runWhatsAppImportJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: WhatsAppImportJobPayload,
  deps: { now?: () => Date; store?: ObjectStore; gateway?: AiGateway } = {},
): Promise<void> {
  try {
    const result = await runWhatsAppImport({ db: ctx.db, ...deps }, payload);
    if (result.outcome === 'missing') {
      throw new RetryableError('CAPTURE_NOT_VISIBLE', 'capture not visible yet');
    }
    ctx.log.info(
      {
        captureId: payload.captureId,
        outcome: result.outcome,
        ...(result.outcome === 'imported'
          ? { structured: result.structured, items: result.items, proposals: result.proposals }
          : {}),
      },
      'whatsapp chat imported',
    );
  } catch (error) {
    if (ctx.attempt > CAPTURE_JOB_RETRIES) {
      await markCaptureFailed(rootDb, payload.workspaceId, payload.captureId, 'processing_failed');
    }
    throw error;
  }
}

export const whatsappImport = defineJob({
  name: CAPTURE_JOB_NAMES.whatsappImport,
  schema: whatsappImportSchema,
  singleton: { key: (payload) => `whatsapp-import:${payload.captureId}` },
  idempotencyKey: (payload) => `whatsapp-import:${payload.captureId}`,
  concurrency: 2,
  retry: { limit: CAPTURE_JOB_RETRIES, delaySec: CAPTURE_JOB_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runWhatsAppImportJob(ctx, payload);
  },
});
