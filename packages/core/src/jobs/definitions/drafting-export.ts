// `drafting.export` (#768): renders one draft version to DOCX or PDF, stores it encrypted under the
// workspace's export prefix and records `draft_export` (`runDraftingExport`). The payload is ids and
// the format only (plus the requesting member, who is the audit actor). Singleton per version and
// format; a rerun finds the stored row and returns it, so a retry never stores a second file. It
// writes through the root client, as `export.build` does: every write runs in its own `withWorkspace`
// scope. A missing version, a blocked slot or a denied member cannot succeed on retry.
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb, type Database, type Transaction } from '@causedeck/db';
import { MissingSlotsError, PdfTooLargeError } from '@causedeck/drafting';
import {
  createObjectStoreFromEnv,
  EnvKeyProvider,
  type KeyProvider,
  type ObjectStore,
} from '@causedeck/storage';
import { EXPORT_FORMATS } from '@causedeck/validators/drafting';
import { z } from 'zod';

import { runDraftingExport, type DraftingExportResult } from '../../drafting/index.ts';
import { WorkspaceError } from '../../shared/errors.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { PermanentError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const draftingExportSchema = z.object({
  workspaceId: workspaceIdSchema,
  draftVersionId: z.uuid(),
  format: z.enum(EXPORT_FORMATS),
  userId: z.uuid(),
});

export type DraftingExportJobPayload = z.output<typeof draftingExportSchema>;

/** Retries after the first attempt. */
export const DRAFTING_EXPORT_RETRIES = 2;

export interface DraftingExportJobDeps {
  db?: Database | Transaction;
  store?: ObjectStore;
  keys?: KeyProvider;
  now?: () => Date;
}

let defaultStore: ObjectStore | undefined;
let defaultKeys: KeyProvider | undefined;

/** The job body. Exported for tests. */
export async function runDraftingExportJob(
  ctx: Pick<JobContext, 'log'>,
  payload: DraftingExportJobPayload,
  deps: DraftingExportJobDeps = {},
): Promise<DraftingExportResult> {
  try {
    return await runDraftingExport(
      {
        db: deps.db ?? rootDb,
        store: deps.store ?? (defaultStore ??= createObjectStoreFromEnv(serverEnv())),
        keys: deps.keys ?? (defaultKeys ??= EnvKeyProvider.fromEnv(serverEnv())),
        log: ctx.log,
        ...(deps.now ? { now: deps.now } : {}),
      },
      payload,
    );
  } catch (error) {
    if (
      error instanceof MissingSlotsError ||
      error instanceof PdfTooLargeError ||
      error instanceof WorkspaceError
    ) {
      // Codes only: the messages of these errors never carry draft text.
      throw new PermanentError('DRAFT_EXPORT_REFUSED', error.name, { cause: error });
    }
    throw error;
  }
}

/** Send one `drafting.export` job as the registry's `enqueue` does. */
export async function enqueueDraftingExport(job: DraftingExportJobPayload): Promise<unknown> {
  const data = draftingExportSchema.parse(job);
  const sender = await getProducer();
  return sender.send('drafting.export', data, {
    singletonKey: `${data.draftVersionId}:${data.format}`,
    group: { id: data.workspaceId },
  });
}

export const draftingExport = defineJob({
  name: 'drafting.export',
  schema: draftingExportSchema,
  singleton: { key: (payload) => `${payload.draftVersionId}:${payload.format}` },
  idempotencyKey: (payload) => `${payload.draftVersionId}:${payload.format}`,
  concurrency: 2,
  timeoutSec: 300,
  retry: { limit: DRAFTING_EXPORT_RETRIES, delaySec: 30 },
  handler: async (ctx, payload) => {
    await runDraftingExportJob(ctx, payload);
  },
});
