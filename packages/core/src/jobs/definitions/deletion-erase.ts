// `deletion.erase` (#302): erases one workspace once its cool-off has ended (`runWorkspaceErase`:
// revoke access, destroy the DEK, delete blobs, purge rows, receipt and tombstone). Enqueued by
// `system.deletion.tick` with ids only. It writes through the root client rather than the job's
// `withWorkspace` transaction, so each step's checkpoint commits on its own and a crash or retry
// resumes after the last finished step. Singleton per deletion; after the last attempt the job is
// marked `failed` with an error code only (the runbook re-enqueues it; it resumes where it stopped).
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb, schema, withWorkspace, type Queryable } from '@causedeck/db';
import { createEmailTransport, type EmailTransport } from '@causedeck/notifications/email';
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { runWorkspaceErase, type EraseOutcome } from '../../lifecycle/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

const { deletionJob } = schema;

export const deletionEraseSchema = z.object({
  workspaceId: workspaceIdSchema,
  jobId: z.uuid(),
});

export type DeletionErasePayload = z.output<typeof deletionEraseSchema>;

/** Retries after the first attempt (with backoff), each resuming from the checkpoints. */
export const DELETION_ERASE_RETRIES = 5;

export interface DeletionEraseJobDeps {
  db?: Queryable;
  store?: ObjectStore;
  email?: EmailTransport;
  secret?: string;
  appUrl?: string;
  now?: () => Date;
  crashAfter?: (point: string) => void;
}

let defaultStore: ObjectStore | undefined;
let defaultEmail: EmailTransport | undefined;

/** The job body. Exported for tests. */
export async function runDeletionEraseJob(
  ctx: Pick<JobContext, 'log' | 'attempt'>,
  payload: DeletionErasePayload,
  deps: DeletionEraseJobDeps = {},
): Promise<EraseOutcome> {
  const db = deps.db ?? rootDb;
  const env = deps.secret === undefined || deps.appUrl === undefined ? serverEnv() : undefined;
  try {
    return await runWorkspaceErase({ db, log: ctx.log }, payload, {
      store: deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv())),
      email: deps.email ?? (defaultEmail ??= createEmailTransport(serverEnv(), ctx.log)),
      secret: deps.secret ?? env?.BETTER_AUTH_SECRET.reveal() ?? '',
      appUrl: deps.appUrl ?? env?.APP_URL ?? '',
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.crashAfter ? { crashAfter: deps.crashAfter } : {}),
    });
  } catch (error) {
    if (ctx.attempt > DELETION_ERASE_RETRIES) {
      const raw: unknown = error instanceof Error ? (error as { code?: unknown }).code : undefined;
      const code = typeof raw === 'string' ? raw : error instanceof Error ? error.name : 'NonError';
      await markFailed(db, payload, code).catch(() => undefined);
    }
    throw error;
  }
}

/** Last attempt failed: `failed`, with the error code in `steps.failure` (no message, no content). */
async function markFailed(db: Queryable, payload: DeletionErasePayload, code: string) {
  await withWorkspace(db, { workspaceId: payload.workspaceId }, (tx) =>
    tx
      .update(deletionJob)
      .set({
        status: 'failed',
        steps: sql`${deletionJob.steps} || ${JSON.stringify({ failure: { code, at: new Date().toISOString() } })}::jsonb`,
      })
      .where(
        and(
          eq(deletionJob.id, payload.jobId),
          inArray(deletionJob.status, ['scheduled', 'running']),
        ),
      ),
  );
}

/** Send one `deletion.erase` job as the registry's `enqueue` does. */
export async function enqueueDeletionErase(job: DeletionErasePayload): Promise<unknown> {
  const data = deletionEraseSchema.parse(job);
  const sender = await getProducer();
  return sender.send('deletion.erase', data, {
    singletonKey: `deletion-erase:${data.jobId}`,
    group: { id: data.workspaceId },
  });
}

export const deletionErase = defineJob({
  name: 'deletion.erase',
  schema: deletionEraseSchema,
  singleton: { key: (payload) => `deletion-erase:${payload.jobId}` },
  concurrency: 1,
  fairnessConcurrency: 1,
  timeoutSec: 3600,
  retry: { limit: DELETION_ERASE_RETRIES, delaySec: 60, backoff: true },
  handler: async (ctx, payload) => {
    await runDeletionEraseJob(ctx, payload);
  },
});
