// `once()` (spike §3.2): run a side effect at most once per (workspace, job, key). The claim row
// in `job_effect` is written in the job's own `withWorkspace` transaction, so a failed effect
// releases it and a duplicate delivery waits for, then skips, the first.
import { schema } from '@causedeck/db';

import type { JobContext } from './context.ts';
import { PermanentError } from './errors.ts';

export type OnceResult<T> = { skipped: true } | { skipped: false; value: T };

export async function once<T>(
  ctx: JobContext,
  key: string,
  fn: () => Promise<T>,
): Promise<OnceResult<T>> {
  if (ctx.workspaceId === null) {
    throw new PermanentError('ONCE_NEEDS_WORKSPACE', 'once() needs a workspace-scoped job');
  }
  const claimed = await ctx.db
    .insert(schema.jobEffect)
    .values({ jobName: ctx.jobName, idempotencyKey: key, workspaceId: ctx.workspaceId })
    .onConflictDoNothing({
      target: [
        schema.jobEffect.workspaceId,
        schema.jobEffect.jobName,
        schema.jobEffect.idempotencyKey,
      ],
    })
    .returning({ id: schema.jobEffect.id });
  if (claimed.length === 0) {
    ctx.log.info('effect already applied; skipping');
    return { skipped: true };
  }
  return { skipped: false, value: await fn() };
}
