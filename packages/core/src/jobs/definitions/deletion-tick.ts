// `system.deletion.tick` (#302): hourly at :45. Moves every workspace deletion whose 14-day cool-off
// has ended to `scheduled` and enqueues `deletion.erase` (ids only); re-enqueues a deletion a crash
// left scheduled or running. The listing goes through the owner-defined `app_deletion_due_jobs`
// (0032); each update runs in its own workspace's scope. Idempotent.
import { z } from 'zod';

import { runDeletionTick } from '../../lifecycle/index.ts';
import { defineJob } from '../define.ts';

import { enqueueDeletionErase } from './deletion-erase.ts';

export const deletionTick = defineJob({
  name: 'system.deletion.tick',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'deletion-tick', policy: 'stately' },
  schedule: { cron: '45 * * * *', payload: {} },
  handler: async (ctx) => {
    await runDeletionTick(ctx, { enqueue: enqueueDeletionErase });
  },
});
