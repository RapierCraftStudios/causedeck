// `voice.process` (#542): transcribes and structures a voice recording (`capture.process` claims
// the capture and queues this job for channel `voice`). The body is `runVoiceProcess` in the voice
// domain. Ids only in the payload; singleton per capture. Five attempts with exponential backoff;
// when they run out the capture is marked `failed` (`processing_failed`).
import type { AiGateway } from '@causedeck/ai';
import {
  CAPTURE_JOB_NAMES,
  CAPTURE_JOB_RETRIES,
  CAPTURE_JOB_RETRY_DELAY_SEC,
} from '@causedeck/capture';
import { db as rootDb } from '@causedeck/db';
import type { IntelligenceEvents, TranscribePort } from '@causedeck/intelligence';
import type { ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import { markCaptureFailed } from '../../capture/index.ts';
import { runVoiceProcess } from '../../voice/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const voiceProcessSchema = z.object({
  workspaceId: workspaceIdSchema,
  captureId: z.uuid(),
});

export type VoiceProcessJobPayload = z.output<typeof voiceProcessSchema>;

/** Send one `voice.process` job as the registry's `enqueue` does. */
export async function enqueueVoiceProcess(payload: VoiceProcessJobPayload): Promise<unknown> {
  const data = voiceProcessSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.voiceProcess, data, {
    singletonKey: `voice-process:${data.captureId}`,
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runVoiceProcessJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: VoiceProcessJobPayload,
  deps: {
    now?: () => Date;
    store?: ObjectStore;
    gateway?: AiGateway;
    transcriber?: TranscribePort;
    events?: IntelligenceEvents;
  } = {},
): Promise<void> {
  try {
    const result = await runVoiceProcess({ db: ctx.db, ...deps }, payload);
    if (result.outcome === 'missing') {
      throw new RetryableError('CAPTURE_NOT_VISIBLE', 'capture not visible yet');
    }
    ctx.log.info(
      {
        captureId: payload.captureId,
        outcome: result.outcome,
        ...(result.outcome === 'structured' ? { proposals: result.proposals } : {}),
      },
      'voice capture processed',
    );
  } catch (error) {
    if (ctx.attempt > CAPTURE_JOB_RETRIES) {
      await markCaptureFailed(rootDb, payload.workspaceId, payload.captureId, 'processing_failed');
    }
    throw error;
  }
}

export const voiceProcess = defineJob({
  name: CAPTURE_JOB_NAMES.voiceProcess,
  schema: voiceProcessSchema,
  singleton: { key: (payload) => `voice-process:${payload.captureId}` },
  idempotencyKey: (payload) => `voice-process:${payload.captureId}`,
  concurrency: 2,
  retry: { limit: CAPTURE_JOB_RETRIES, delaySec: CAPTURE_JOB_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runVoiceProcessJob(ctx, payload);
  },
});
