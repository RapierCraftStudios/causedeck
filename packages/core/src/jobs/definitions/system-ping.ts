// `system.ping`: a harmless job for tests and smoke checks. It records one `job_effect` row per
// (workspace, nonce) through `once()`.
import { z } from 'zod';

import { defineJob, fairnessKeySchema, workspaceIdSchema } from '../define.ts';
import { once } from '../idempotency.ts';

export const systemPing = defineJob({
  name: 'system.ping',
  schema: z.object({
    workspaceId: workspaceIdSchema,
    fairnessKey: fairnessKeySchema,
    nonce: z.string().min(1).max(64).optional(),
  }),
  idempotencyKey: (payload) => payload.nonce ?? 'ping',
  handler: async (ctx) => {
    const result = await once(ctx, ctx.idempotencyKey, () => Promise.resolve());
    ctx.log.info({ skipped: result.skipped }, 'pong');
  },
});
