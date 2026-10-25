// `system.memory.purge` and `memory.purge` (#72, ADR 0038). Deleting a memory item removes its value
// at once, but its embeddings stay until this sweep. The system job runs hourly (so a deleted item's
// vectors are gone well inside 24 h), lists the workspaces that still hold embeddings of deleted
// items (ids only, through the owner-defined `app_memory_purge_targets` function) and queues
// `memory.purge` for each; that job deletes them under the workspace scope. Idempotent.
import { z } from 'zod';

import { purgeDeletedMemoryEmbeddings, purgeMemoryTargets } from '../../memory/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

export const memoryPurgeSchema = z.object({ workspaceId: workspaceIdSchema });

async function enqueueMemoryPurge(workspaceId: string): Promise<unknown> {
  const data = memoryPurgeSchema.parse({ workspaceId });
  const sender = await getProducer();
  return sender.send('memory.purge', data, {
    singletonKey: `memory-purge:${data.workspaceId}`,
    group: { id: data.workspaceId },
  });
}

/** Queue `memory.purge` for every workspace with embeddings of deleted items. Exported for tests. */
export async function runMemoryPurgeSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: { enqueue?: (workspaceId: string) => Promise<unknown> } = {},
): Promise<string[]> {
  const send = deps.enqueue ?? enqueueMemoryPurge;
  const workspaces = await purgeMemoryTargets(ctx.db);
  for (const workspaceId of workspaces) await send(workspaceId);
  ctx.log.info({ enqueued: workspaces.length }, 'memory purge scheduled');
  return workspaces;
}

export const systemMemoryPurge = defineJob({
  name: 'system.memory.purge',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'memory-purge', policy: 'stately' },
  schedule: { cron: '0 * * * *', payload: {} },
  handler: async (ctx) => {
    await runMemoryPurgeSchedule(ctx);
  },
});

export const memoryPurge = defineJob({
  name: 'memory.purge',
  schema: memoryPurgeSchema,
  concurrency: 2,
  singleton: { key: (payload) => `memory-purge:${payload.workspaceId}` },
  handler: async (ctx, { workspaceId }) => {
    const purged = await purgeDeletedMemoryEmbeddings(ctx.db, workspaceId);
    ctx.log.info({ purged }, 'embeddings of deleted memory purged');
  },
});
