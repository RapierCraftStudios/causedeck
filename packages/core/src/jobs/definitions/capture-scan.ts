// `capture.scan` (#43): streams one capture's raw object to the scanner (ClamAV when
// `CAPTURE_CLAMAV_HOST` is set, else a no-op), then queues `capture.process` or quarantines the
// object. The body is `runCaptureScan` in the capture domain; this file wires the job. Five
// attempts with exponential backoff; when they run out the capture is marked `failed` with the
// user-safe reason `scan_unavailable` (in its own transaction, as the job's own rolls back).
// Singleton per capture and hash, so re-queuing the same bytes sends nothing new.
import {
  CAPTURE_JOB_NAMES,
  CAPTURE_JOB_RETRIES,
  CAPTURE_JOB_RETRY_DELAY_SEC,
  createScanProvider,
} from '@causedeck/capture';
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb } from '@causedeck/db';
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { z } from 'zod';

import {
  captureConfigFromProcess,
  markCaptureFailed,
  runCaptureScan,
  type CaptureJobs,
} from '../../capture/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const captureScanSchema = z.object({
  workspaceId: workspaceIdSchema,
  captureId: z.uuid(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export type CaptureScanJobPayload = z.output<typeof captureScanSchema>;

let defaultStore: ObjectStore | undefined;

/** Send one `capture.scan` job as the registry's `enqueue` does. */
export async function enqueueCaptureScan(payload: CaptureScanJobPayload): Promise<unknown> {
  const data = captureScanSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(CAPTURE_JOB_NAMES.scan, data, {
    singletonKey: `capture-scan:${data.captureId}:${data.sha256}`,
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runCaptureScanJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: CaptureScanJobPayload,
  deps: { store?: ObjectStore; jobs?: CaptureJobs; now?: () => Date } = {},
): Promise<void> {
  const config = captureConfigFromProcess();
  const jobs: CaptureJobs = deps.jobs ?? {
    scan: enqueueCaptureScan,
    // Resolved lazily: `capture-process.ts` imports nothing from this file.
    process: async (p) => (await import('./capture-process.ts')).enqueueCaptureProcess(p),
  };
  try {
    const outcome = await runCaptureScan(
      {
        db: ctx.db,
        store: deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv())),
        config,
        scanner: createScanProvider(config.scan),
        jobs,
        ...(deps.now ? { now: deps.now } : {}),
      },
      payload,
    );
    if (outcome === 'missing')
      throw new RetryableError('CAPTURE_NOT_VISIBLE', 'capture not visible yet');
    ctx.log.info({ captureId: payload.captureId, outcome }, 'capture scanned');
  } catch (error) {
    if (ctx.attempt > CAPTURE_JOB_RETRIES) {
      await markCaptureFailed(rootDb, payload.workspaceId, payload.captureId, 'scan_unavailable');
    }
    throw error;
  }
}

export const captureScan = defineJob({
  name: CAPTURE_JOB_NAMES.scan,
  schema: captureScanSchema,
  singleton: { key: (payload) => `capture-scan:${payload.captureId}:${payload.sha256}` },
  idempotencyKey: (payload) => `capture-scan:${payload.captureId}:${payload.sha256}`,
  concurrency: 2,
  timeoutSec: 300,
  retry: { limit: CAPTURE_JOB_RETRIES, delaySec: CAPTURE_JOB_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runCaptureScanJob(ctx, payload);
  },
});
