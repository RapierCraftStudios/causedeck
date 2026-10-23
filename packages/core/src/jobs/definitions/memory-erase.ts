// `memory.erase` (#303): erases one workspace's memory and embeddings (`runMemoryErasure`) inside
// the job's workspace transaction. `requestMemoryErasure` enqueues it with ids only and priority
// `MEMORY_ERASE_PRIORITY`, so it runs ahead of the default-priority queue: the request must be
// complete within 24 h (NFR Privacy; the job's `erase_after` records the deadline). Singleton per
// deletion job; idempotent, so a retry after a crash simply reruns the erase.
import { z } from 'zod';

import {
  MEMORY_ERASE_PRIORITY,
  runMemoryErasure,
  type MemoryErasureOutcome,
} from '../../lifecycle/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

export const memoryEraseSchema = z.object({
  workspaceId: workspaceIdSchema,
  jobId: z.uuid(),
});

export type MemoryErasePayload = z.output<typeof memoryEraseSchema>;

/** Retries after the first attempt. */
export const MEMORY_ERASE_RETRIES = 3;

/** The job body. Exported for tests. */
export function runMemoryEraseJob(
  ctx: Pick<JobContext, 'log' | 'db'>,
  payload: MemoryErasePayload,
  deps: { now?: () => Date } = {},
): Promise<MemoryErasureOutcome> {
  return runMemoryErasure(
    { db: ctx.db, log: ctx.log, ...(deps.now ? { now: deps.now } : {}) },
    payload,
  );
}

/** Send one `memory.erase` job, at `MEMORY_ERASE_PRIORITY`, as the registry's `enqueue` does. */
export async function enqueueMemoryErase(job: MemoryErasePayload): Promise<unknown> {
  const data = memoryEraseSchema.parse(job);
  const sender = await getProducer();
  return sender.send('memory.erase', data, {
    singletonKey: data.jobId,
    group: { id: data.workspaceId },
    priority: MEMORY_ERASE_PRIORITY,
  });
}

export const memoryErase = defineJob({
  name: 'memory.erase',
  schema: memoryEraseSchema,
  singleton: { key: (payload) => payload.jobId },
  idempotencyKey: (payload) => payload.jobId,
  concurrency: 2,
  timeoutSec: 1800,
  retry: { limit: MEMORY_ERASE_RETRIES, delaySec: 60 },
  handler: async (ctx, payload) => {
    await runMemoryEraseJob(ctx, payload);
  },
});
