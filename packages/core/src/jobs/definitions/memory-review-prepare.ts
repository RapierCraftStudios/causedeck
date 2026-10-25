// `system.memory.review-prepare` and `memory.review-prepare` (#72, ADR 0038). On the 1st of each
// month at 06:00 IST the system job lists the workspaces that hold memory (ids only, through the
// owner-defined `app_memory_review_targets` function) and queues `memory.review-prepare` for each;
// that job calls `monthlyReview` and logs the counts. Counts and rates only: no value, key or name.
import { z } from 'zod';

import { monthlyReview, reviewMemoryTargets } from '../../memory/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

export const memoryReviewPrepareSchema = z.object({ workspaceId: workspaceIdSchema });

async function enqueueReviewPrepare(workspaceId: string): Promise<unknown> {
  const data = memoryReviewPrepareSchema.parse({ workspaceId });
  const sender = await getProducer();
  return sender.send('memory.review-prepare', data, {
    singletonKey: `memory-review-prepare:${data.workspaceId}`,
    group: { id: data.workspaceId },
  });
}

/** Queue `memory.review-prepare` for every workspace with memory. Exported for tests. */
export async function runMemoryReviewSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: { enqueue?: (workspaceId: string) => Promise<unknown> } = {},
): Promise<string[]> {
  const send = deps.enqueue ?? enqueueReviewPrepare;
  const workspaces = await reviewMemoryTargets(ctx.db);
  for (const workspaceId of workspaces) await send(workspaceId);
  ctx.log.info({ enqueued: workspaces.length }, 'memory review scheduled');
  return workspaces;
}

export const systemMemoryReviewPrepare = defineJob({
  name: 'system.memory.review-prepare',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'memory-review-prepare', policy: 'stately' },
  schedule: { cron: '0 6 1 * *', payload: {} },
  handler: async (ctx) => {
    await runMemoryReviewSchedule(ctx);
  },
});

export const memoryReviewPrepare = defineJob({
  name: 'memory.review-prepare',
  schema: memoryReviewPrepareSchema,
  concurrency: 2,
  singleton: { key: (payload) => `memory-review-prepare:${payload.workspaceId}` },
  handler: async (ctx, { workspaceId }) => {
    const review = await monthlyReview({ db: ctx.db }, workspaceId);
    ctx.log.info(
      {
        activeItems: review.activeItems,
        pausedItems: review.pausedItems,
        staleItems: review.staleItems,
        pendingProposals: review.pendingProposals,
      },
      'memory review prepared',
    );
  },
});
