// `account.delete` (#303): deletes one account (`runAccountDeletion`: re-check the sole-owner and
// staff blocks, strip matter restrictions, delete the user and anonymise its audit events in one
// transaction). `requestAccountDeletion` enqueues it with ids only. The account has no workspace,
// so the payload's `workspaceId` is null, the handler gets the root client (each step opens its own
// `withUser` / `withWorkspace` scope) and fairness groups by the user. Singleton per deletion job;
// every step is idempotent, so a retry resumes where the last attempt stopped.
import { db as rootDb, type Queryable } from '@causedeck/db';
import { z } from 'zod';

import { runAccountDeletion, type AccountDeletionOutcome } from '../../lifecycle/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { getProducer } from '../producer.ts';

export const accountDeleteSchema = z.object({
  workspaceId: z.null(),
  userId: z.uuid(),
  jobId: z.uuid(),
  fairnessKey: z.uuid().optional(),
});

export type AccountDeletePayload = z.input<typeof accountDeleteSchema>;

/** Retries after the first attempt. */
export const ACCOUNT_DELETE_RETRIES = 3;

/** The job body. Exported for tests. */
export function runAccountDeleteJob(
  ctx: Pick<JobContext, 'log'>,
  payload: { userId: string; jobId: string },
  deps: { db?: Queryable; now?: () => Date } = {},
): Promise<AccountDeletionOutcome> {
  return runAccountDeletion(
    { db: deps.db ?? rootDb, log: ctx.log, ...(deps.now ? { now: deps.now } : {}) },
    { userId: payload.userId, jobId: payload.jobId },
  );
}

/** Send one `account.delete` job as the registry's `enqueue` does. */
export async function enqueueAccountDelete(job: {
  userId: string;
  jobId: string;
}): Promise<unknown> {
  const data = accountDeleteSchema.parse({ workspaceId: null, ...job, fairnessKey: job.userId });
  const sender = await getProducer();
  return sender.send('account.delete', data, {
    singletonKey: data.jobId,
    group: { id: job.userId },
  });
}

export const accountDelete = defineJob({
  name: 'account.delete',
  schema: accountDeleteSchema,
  singleton: { key: (payload) => payload.jobId },
  idempotencyKey: (payload) => payload.jobId,
  concurrency: 1,
  fairnessConcurrency: 1,
  timeoutSec: 600,
  retry: { limit: ACCOUNT_DELETE_RETRIES, delaySec: 30 },
  handler: async (ctx, payload) => {
    await runAccountDeleteJob(ctx, payload);
  },
});
