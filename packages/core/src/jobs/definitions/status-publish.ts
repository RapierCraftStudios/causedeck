// `system.status.publish` (#769, part 1 of #96): every minute, builds the sanitised, signed status
// snapshot and writes `status/status.json` to the public static path through the storage
// abstraction (`publishStatus`). It has no workspace, so it is `system.*` by rule (not to be confused
// with `system.status.poll`, the case-status watch poll). Overlap-safe: one run at a time
// (`singleton`), and a run whose snapshot is unchanged writes nothing. Only the outcome is logged.
import { serverEnv } from '@causedeck/config/env';
import { createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  publishStatus,
  type PublishStatusDeps,
  type PublishStatusResult,
} from '../../status/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

export const STATUS_PUBLISH_CRON = '* * * * *';

let defaultStore: ObjectStore | undefined;

/** Publish once. `deps` replaces the store, key and checks (tests); the worker passes none. */
export async function runStatusPublish(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: Partial<Pick<PublishStatusDeps, 'signingKey' | 'checks' | 'now'>> & {
    store?: ObjectStore;
  } = {},
): Promise<PublishStatusResult> {
  const env = deps.store === undefined || deps.signingKey === undefined ? serverEnv() : undefined;
  const store = deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv()));
  const result = await publishStatus({
    db: ctx.db,
    store,
    signingKey: deps.signingKey ?? env?.STATUS_SIGNING_KEY.reveal() ?? '',
    checks: deps.checks ?? [
      {
        id: 'database',
        check: async () => {
          await ctx.db.execute(sql`select 1`);
        },
      },
      { id: 'storage', check: () => store.ping() },
    ],
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
  ctx.log.info(
    { published: result.published, reason: result.reason, overall: result.snapshot.overall },
    'status publish complete',
  );
  return result;
}

export const statusPublish = defineJob({
  name: 'system.status.publish',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  retry: { limit: 0 },
  singleton: { key: () => 'status-publish', policy: 'stately' },
  schedule: { cron: STATUS_PUBLISH_CRON, payload: {} },
  handler: async (ctx) => {
    await runStatusPublish(ctx);
  },
});
