// `drafting.consistency.check` (#78): checks one draft version against the matter graph and stores the
// report (`runConsistencyCheck`). The payload is ids only (plus the requesting member, whose
// visibility the facts are read with). Singleton per version; a rerun finds the stored report for the
// same graph revision, so a retry never stores a second one. A missing version or a denied member
// cannot succeed on retry. Nothing here logs a finding, a span or draft text.
import { db as rootDb, type Database, type Transaction } from '@causedeck/db';
import { z } from 'zod';

import { runConsistencyCheck, type StoredReport } from '../../drafting/index.ts';
import { WorkspaceError } from '../../shared/errors.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { PermanentError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const draftingConsistencyCheckSchema = z.object({
  workspaceId: workspaceIdSchema,
  draftVersionId: z.uuid(),
  userId: z.uuid(),
});

export type DraftingConsistencyCheckPayload = z.output<typeof draftingConsistencyCheckSchema>;

export interface DraftingConsistencyCheckDeps {
  db?: Database | Transaction;
  now?: () => Date;
}

/** The job body. Exported for tests. */
export async function runDraftingConsistencyCheckJob(
  ctx: Pick<JobContext, 'log'>,
  payload: DraftingConsistencyCheckPayload,
  deps: DraftingConsistencyCheckDeps = {},
): Promise<StoredReport> {
  try {
    const report = await runConsistencyCheck(
      { db: deps.db ?? rootDb, ...(deps.now ? { now: deps.now } : {}) },
      { workspaceId: payload.workspaceId, userId: payload.userId },
      { draftVersionId: payload.draftVersionId },
    );
    // Counts only: findings carry spans and names, which never reach a log.
    ctx.log.info({ draftVersionId: payload.draftVersionId, counts: report.counts }, 'consistency checked');
    return report;
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw new PermanentError('DRAFT_CONSISTENCY_REFUSED', error.code, { cause: error });
    }
    throw error;
  }
}

/** Send one `drafting.consistency.check` job as the registry's `enqueue` does. */
export async function enqueueDraftingConsistencyCheck(
  job: DraftingConsistencyCheckPayload,
): Promise<unknown> {
  const data = draftingConsistencyCheckSchema.parse(job);
  const sender = await getProducer();
  return sender.send('drafting.consistency.check', data, {
    singletonKey: data.draftVersionId,
    group: { id: data.workspaceId },
  });
}

export const draftingConsistencyCheck = defineJob({
  name: 'drafting.consistency.check',
  schema: draftingConsistencyCheckSchema,
  singleton: { key: (payload) => payload.draftVersionId },
  idempotencyKey: (payload) => payload.draftVersionId,
  concurrency: 2,
  timeoutSec: 60,
  retry: { limit: 2, delaySec: 30 },
  handler: async (ctx, payload) => {
    await runDraftingConsistencyCheckJob(ctx, payload);
  },
});
