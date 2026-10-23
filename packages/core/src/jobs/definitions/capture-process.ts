// `capture.process` (#43): the hand-off to the document pipeline (#45). `runCaptureProcess` claims
// the capture (`queued -> processing`) and reports whether AI steps may run; that is decided by
// the capture's `ai_blocked` flag, never by the payload (CA-10). Idempotent per capture and
// pipeline version (singleton key; a capture that already left `queued` is skipped). Five attempts
// with exponential backoff; when they run out the capture is marked `failed` (`processing_failed`).
import {
  CAPTURE_JOB_NAMES,
  CAPTURE_JOB_RETRIES,
  CAPTURE_JOB_RETRY_DELAY_SEC,
} from '@causedeck/capture';
import { db as rootDb } from '@causedeck/db';
import type { ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import { runIcsImport } from '../../calendar/index.ts';
import { markCaptureFailed, runCaptureProcess } from '../../capture/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';
import { enqueueWhatsAppImport } from './whatsapp-import.ts';

export const captureProcessSchema = z.object({
  workspaceId: workspaceIdSchema,
  captureId: z.uuid(),
  pipelineVersion: z.string().min(1).max(64),
});

export type CaptureProcessJobPayload = z.output<typeof captureProcessSchema>;

/** Send one `capture.process` job as the registry's `enqueue` does. */
export async function enqueueCaptureProcess(payload: CaptureProcessJobPayload): Promise<unknown> {
  const data = captureProcessSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.process, data, {
    singletonKey: `capture-process:${data.captureId}:${data.pipelineVersion}`,
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runCaptureProcessJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: CaptureProcessJobPayload,
  deps: { now?: () => Date; store?: ObjectStore } = {},
): Promise<void> {
  try {
    const result = await runCaptureProcess({ db: ctx.db, ...deps }, payload);
    if (result.outcome === 'missing') {
      throw new RetryableError('CAPTURE_NOT_VISIBLE', 'capture not visible yet');
    }
    ctx.log.info(
      {
        captureId: payload.captureId,
        outcome: result.outcome,
        ...(result.outcome === 'started' ? { aiSteps: result.aiSteps } : {}),
      },
      'capture processed',
    );
    // The ICS channel (#53) is read deterministically: no model is involved, so `aiSteps` does not
    // matter and a sensitive-matter hint cannot be bypassed (events of sensitive matters are dropped).
    if (result.outcome === 'started' && result.channel === 'ics') {
      const imported = await runIcsImport(
        { db: ctx.db, ...deps },
        { workspaceId: payload.workspaceId, captureId: payload.captureId },
      );
      ctx.log.info(
        {
          captureId: payload.captureId,
          outcome: imported.outcome,
          ...(imported.outcome === 'imported' ? { summary: imported.summary } : {}),
        },
        'ics imported',
      );
    }
    // A WhatsApp chat (#526) is structured by its own job, which owns the model call and its retries.
    if (result.outcome === 'started' && result.channel === 'whatsapp_export') {
      await enqueueWhatsAppImport({
        workspaceId: payload.workspaceId,
        captureId: payload.captureId,
      });
    }
  } catch (error) {
    if (ctx.attempt > CAPTURE_JOB_RETRIES) {
      await markCaptureFailed(rootDb, payload.workspaceId, payload.captureId, 'processing_failed');
    }
    throw error;
  }
}

export const captureProcess = defineJob({
  name: CAPTURE_JOB_NAMES.process,
  schema: captureProcessSchema,
  singleton: {
    key: (payload) => `capture-process:${payload.captureId}:${payload.pipelineVersion}`,
  },
  idempotencyKey: (payload) => `capture-process:${payload.captureId}:${payload.pipelineVersion}`,
  concurrency: 2,
  retry: { limit: CAPTURE_JOB_RETRIES, delaySec: CAPTURE_JOB_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runCaptureProcessJob(ctx, payload);
  },
});
