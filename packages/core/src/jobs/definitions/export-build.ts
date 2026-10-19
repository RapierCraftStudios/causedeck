// `export.build` (#301): builds one workspace export (`runExportBuild`: streaming ZIP, encrypted
// multipart upload, progress and `steps` checkpoints). `requestExport` enqueues it with ids only.
// It writes through the root client rather than the job's `withWorkspace` transaction, so progress
// is visible while it runs and the stored export survives the job transaction; every write still
// runs in its own `withWorkspace` scope. Singleton per export; a retry rebuilds from scratch and
// the last retry marks the export `failed`. Runs for up to an hour.
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb, type Queryable } from '@causedeck/db';
import {
  createObjectStoreFromEnv,
  EnvKeyProvider,
  type KeyProvider,
  type ObjectStore,
} from '@causedeck/storage';
import { z } from 'zod';

import { runExportBuild, type ExportBuildOutcome } from '../../lifecycle/export/run.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { getProducer } from '../producer.ts';

export const exportBuildSchema = z.object({
  workspaceId: workspaceIdSchema,
  jobId: z.uuid(),
});

export type ExportBuildPayload = z.output<typeof exportBuildSchema>;

/** Retries after the first attempt. */
export const EXPORT_BUILD_RETRIES = 2;

export interface ExportBuildJobDeps {
  db?: Queryable;
  store?: ObjectStore;
  keys?: KeyProvider;
  now?: () => Date;
}

let defaultStore: ObjectStore | undefined;
let defaultKeys: KeyProvider | undefined;

/** The job body. Exported for tests. */
export function runExportBuildJob(
  ctx: Pick<JobContext, 'log' | 'attempt'>,
  payload: ExportBuildPayload,
  deps: ExportBuildJobDeps = {},
): Promise<ExportBuildOutcome> {
  return runExportBuild(
    { db: deps.db ?? rootDb, log: ctx.log, finalAttempt: ctx.attempt > EXPORT_BUILD_RETRIES },
    payload,
    {
      store: deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv())),
      keys: deps.keys ?? (defaultKeys ??= EnvKeyProvider.fromEnv(serverEnv())),
      ...(deps.now ? { now: deps.now } : {}),
    },
  );
}

/** Send one `export.build` job as the registry's `enqueue` does. */
export async function enqueueExportBuild(job: ExportBuildPayload): Promise<unknown> {
  const data = exportBuildSchema.parse(job);
  const sender = await getProducer();
  return sender.send('export.build', data, {
    singletonKey: data.jobId,
    group: { id: data.workspaceId },
  });
}

export const exportBuild = defineJob({
  name: 'export.build',
  schema: exportBuildSchema,
  singleton: { key: (payload) => payload.jobId },
  idempotencyKey: (payload) => payload.jobId,
  concurrency: 1,
  fairnessConcurrency: 1,
  timeoutSec: 3600,
  retry: { limit: EXPORT_BUILD_RETRIES, delaySec: 30 },
  handler: async (ctx, payload) => {
    await runExportBuildJob(ctx, payload);
  },
});
