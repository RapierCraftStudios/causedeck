// `import.batch` and `import.file` (#57 part 4, #550): the bootstrap import's fan-out. `import.batch`
// puts the batch in `processing`, keeps the files past the free-plan OCR cap as attachments (never
// read, no AI called) and queues one `import.file` per file to read. `import.file` reads one file
// once its capture left the document pipeline (`processImportFile`; a capture still in the pipeline
// is retried with backoff) and, when no file is waiting any more, builds the plan
// (`finishImportBatch`). A file whose attempts run out is marked `failed` in its own transaction (the
// job's own rolls back) and the batch finishes without it; `reprocess` runs failed files again.
// Ids only in the payloads; singleton per batch and per file.
import { db as rootDb } from '@causedeck/db';
import { z } from 'zod';

import {
  finishImportBatch,
  markImportFileFailed,
  markImportFilesOverCap,
  processImportFile,
  splitByOcrAllowance,
  startImportProcessing,
  type ImportBatchDeps,
} from '../../import/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const IMPORT_BATCH_JOB_NAME = 'import.batch';
export const IMPORT_FILE_JOB_NAME = 'import.file';
/** A capture can sit in the pipeline for minutes: more attempts than the capture jobs. */
export const IMPORT_FILE_RETRIES = 8;
export const IMPORT_FILE_RETRY_DELAY_SEC = 10;

export const importBatchSchema = z.object({
  workspaceId: workspaceIdSchema,
  batchId: z.uuid(),
  /** Run failed files again (`failed`), or failed and unmatched ones after a profile change. */
  reprocess: z.enum(['failed', 'unmatched']).optional(),
});
export type ImportBatchJobPayload = z.output<typeof importBatchSchema>;

export const importFileSchema = z.object({
  workspaceId: workspaceIdSchema,
  batchId: z.uuid(),
  captureId: z.uuid(),
  /** A reprocess: read the file even though it already ended. */
  force: z.boolean().optional(),
});
export type ImportFileJobPayload = z.output<typeof importFileSchema>;

/** Send one `import.batch` job as the registry's `enqueue` does. */
export async function enqueueImportBatch(
  payload: z.input<typeof importBatchSchema>,
): Promise<unknown> {
  const data = importBatchSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(IMPORT_BATCH_JOB_NAME, data, {
    singletonKey: `import-batch:${data.batchId}`,
    group: { id: data.workspaceId },
  });
}

/** Send one `import.file` job as the registry's `enqueue` does. */
export async function enqueueImportFile(
  payload: z.input<typeof importFileSchema>,
): Promise<unknown> {
  const data = importFileSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(IMPORT_FILE_JOB_NAME, data, {
    singletonKey: `import-file:${data.batchId}:${data.captureId}`,
    group: { id: data.workspaceId },
  });
}

export interface ImportBatchJobDeps extends Omit<ImportBatchDeps, 'db'> {
  /** The producer of the per-file jobs; defaults to the registry's. */
  enqueueFile?: (payload: ImportFileJobPayload) => Promise<unknown>;
}

/** The `import.batch` body. Exported for tests. */
export async function runImportBatchJob(
  ctx: Pick<JobContext, 'db' | 'log'>,
  payload: ImportBatchJobPayload,
  deps: ImportBatchJobDeps = {},
): Promise<void> {
  const { enqueueFile = enqueueImportFile, ...rest } = deps;
  const base: ImportBatchDeps = { db: ctx.db, ...rest };
  const { workspaceId, batchId } = payload;
  const files = await startImportProcessing(base, {
    workspaceId,
    batchId,
    reprocess: payload.reprocess,
  });
  const allowance = await splitByOcrAllowance(
    { db: ctx.db, workspaceId, ...(rest.now ? { now: rest.now } : {}) },
    files.map((file) => ({ id: file.captureId, pages: file.pages })),
  );
  await markImportFilesOverCap(base, { workspaceId, batchId, captureIds: allowance.attachOnly });
  const forced = new Set(files.filter((f) => f.status !== 'pending').map((f) => f.captureId));
  for (const captureId of allowance.read) {
    await enqueueFile({
      workspaceId,
      batchId,
      captureId,
      ...(forced.has(captureId) ? { force: true } : {}),
    });
  }
  ctx.log.info(
    { batchId, queued: allowance.read.length, overCap: allowance.attachOnly.length },
    'import batch started',
  );
  // Nothing left to read (every file ended before): the plan may be ready to build.
  if (allowance.read.length === 0) {
    const done = await finishImportBatch(base, { workspaceId, batchId });
    ctx.log.info({ batchId, outcome: done.outcome }, 'import batch finished');
  }
}

export interface ImportFileJobDeps extends Omit<ImportBatchDeps, 'db'> {
  /**
   * Where a file whose attempts ran out is marked failed: its own transaction, as the job's rolls
   * back with the error. Defaults to the root client.
   */
  failDb?: ImportBatchDeps['db'];
}

/** The `import.file` body. Exported for tests. */
export async function runImportFileJob(
  ctx: Pick<JobContext, 'db' | 'log' | 'attempt'>,
  payload: ImportFileJobPayload,
  deps: ImportFileJobDeps = {},
): Promise<void> {
  const { failDb = rootDb, ...rest } = deps;
  const base: ImportBatchDeps = { db: ctx.db, ...rest };
  const { workspaceId, batchId, captureId } = payload;
  try {
    const result = await processImportFile(base, {
      workspaceId,
      batchId,
      captureId,
      ...(payload.force === true ? { force: true } : {}),
    });
    if (result.outcome === 'waiting') {
      throw new RetryableError('CAPTURE_NOT_READY', 'capture is still in the pipeline');
    }
    ctx.log.info({ batchId, captureId, outcome: result.outcome }, 'import file read');
  } catch (error) {
    if (ctx.attempt > IMPORT_FILE_RETRIES) {
      await markImportFileFailed({ ...base, db: failDb }, { workspaceId, batchId, captureId });
      await finishImportBatch({ ...base, db: failDb }, { workspaceId, batchId });
    }
    throw error;
  }
  const done = await finishImportBatch(base, { workspaceId, batchId });
  ctx.log.info({ batchId, outcome: done.outcome }, 'import batch checked');
}

export const importBatch = defineJob({
  name: IMPORT_BATCH_JOB_NAME,
  schema: importBatchSchema,
  singleton: { key: (payload) => `import-batch:${payload.batchId}` },
  idempotencyKey: (payload) => `import-batch:${payload.batchId}`,
  concurrency: 1,
  handler: async (ctx, payload) => {
    await runImportBatchJob(ctx, payload);
  },
});

export const importFile = defineJob({
  name: IMPORT_FILE_JOB_NAME,
  schema: importFileSchema,
  singleton: { key: (payload) => `import-file:${payload.batchId}:${payload.captureId}` },
  idempotencyKey: (payload) => `import-file:${payload.batchId}:${payload.captureId}`,
  concurrency: 2,
  retry: { limit: IMPORT_FILE_RETRIES, delaySec: IMPORT_FILE_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runImportFileJob(ctx, payload);
  },
});
