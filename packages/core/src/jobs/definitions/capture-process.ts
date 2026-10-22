// `capture.process` (#43, #45): the document pipeline. The registered handler runs
// `runCapturePipeline` (text layer, OCR fallback, language, classification, page images, document
// rows) and moves the capture to `ready` or `needs_you`; whether AI steps may run is decided by the
// capture's `ai_blocked` flag, never by the payload (CA-10). Without `deps.pipeline` the body only
// claims the capture (`queued -> processing`), as `runCaptureProcess` does. Idempotent per capture
// and pipeline version (singleton key; a capture that already left `queued` is skipped). Five
// attempts with exponential backoff; when they run out the capture is marked `failed`
// (`processing_failed`).
import {
  CAPTURE_JOB_NAMES,
  CAPTURE_JOB_RETRIES,
  CAPTURE_JOB_RETRY_DELAY_SEC,
} from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb } from '@causedeck/db';
import { createObjectStoreFromEnv, EnvKeyProvider } from '@causedeck/storage';
import { z } from 'zod';

import { createCoreAiGateway } from '../../ai/index.ts';
import {
  aiStepsAllowed,
  markCaptureFailed,
  runCapturePipeline,
  runCaptureProcess,
  type CapturePipelineDeps,
} from '../../capture/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

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

let defaultStorage: Pick<CapturePipelineDeps, 'store' | 'keys'> | undefined;

/** The pipeline's storage and gateway from the environment: S3 or MinIO, the env KEK, mock AI. */
function defaultPipelineDeps(ctx: Pick<JobContext, 'db'>): CapturePipelineDeps {
  const env = serverEnv();
  defaultStorage ??= {
    store: createObjectStoreFromEnv(env),
    keys: EnvKeyProvider.fromEnv(env),
  };
  return {
    db: ctx.db,
    ...defaultStorage,
    gateway: createCoreAiGateway(ctx.db, {
      isCaptureAiBlocked: async (workspaceId, captureId) =>
        !(await aiStepsAllowed(ctx.db, workspaceId, captureId)),
    }),
  };
}

/** The job body. Exported for tests. */
export async function runCaptureProcessJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: CaptureProcessJobPayload,
  deps: { now?: () => Date; pipeline?: CapturePipelineDeps } = {},
): Promise<void> {
  try {
    if (deps.pipeline !== undefined) {
      const done = await runCapturePipeline(deps.pipeline, payload);
      if (done.outcome === 'missing') {
        throw new RetryableError('CAPTURE_NOT_VISIBLE', 'capture not visible yet');
      }
      ctx.log.info({ captureId: payload.captureId, outcome: done.outcome }, 'capture processed');
      return;
    }
    const result = await runCaptureProcess(
      { db: ctx.db, ...(deps.now ? { now: deps.now } : {}) },
      payload,
    );
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
    await runCaptureProcessJob(ctx, payload, { pipeline: defaultPipelineDeps(ctx) });
  },
});
