// `system.corpus.ocr` (#1030): drains `corpus_ocr_queue`, the judgment pages the bulk importer (#890)
// found without a text layer, through the gateway OCR under the platform scope (no workspace, spend
// metered in `corpus_ocr_call`). Off by default: the schedule fires, but the run does nothing unless
// `CORPUS_OCR_ENABLED` is true. A run is bounded by a page budget, a byte budget and the platform's
// daily AI budget; without provider credentials the mock OCR provider serves the calls (staging).
// Only ids, counts and error codes are logged.
import { serverEnv } from '@causedeck/config/env';
import { db as rootDb, type Queryable } from '@causedeck/db';
import {
  createGatewayOcr,
  drainOcrQueue,
  mupdfRenderer,
  DEFAULT_OCR_DRAIN_BUDGET,
  type OcrDrainReport,
  type PageRenderer,
} from '@causedeck/intelligence';
import { corpusObjectKey, createObjectStoreFromEnv, type ObjectStore } from '@causedeck/storage';
import type { AiGateway } from '@causedeck/ai';
import { z } from 'zod';

import {
  createPlatformAiGateway,
  DEFAULT_PLATFORM_OCR_DAILY_PAISE,
  PLATFORM_AI_SCOPE,
} from '../../ai/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

export const corpusOcrSchema = z.object({
  workspaceId: z.null().optional(),
  maxPages: z.number().int().min(1).max(10_000).optional(),
  maxBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 ** 3)
    .optional(),
});

export type CorpusOcrPayload = z.infer<typeof corpusOcrSchema>;
export type CorpusOcrReport = OcrDrainReport & { skipped: boolean };

export interface CorpusOcrDeps {
  db?: Queryable;
  /** Defaults to `CORPUS_OCR_ENABLED`. */
  enabled?: boolean;
  gateway?: AiGateway;
  renderer?: PageRenderer;
  readBlob?: (key: string) => Promise<Uint8Array>;
  now?: () => Date;
  /** Platform daily AI budget in paise; defaults to `CORPUS_OCR_DAILY_PAISE`. */
  dailyPaise?: number;
}

const EMPTY: CorpusOcrReport = {
  claimed: 0,
  done: 0,
  retried: 0,
  parked: 0,
  bytes: 0,
  budgetReached: false,
  skipped: true,
};

let envStore: ObjectStore | undefined;

/** Reads originals at `corpus/<sha256>.pdf` (ADR 0006) from the deployment's object store. */
function defaultReadBlob(key: string): Promise<Uint8Array> {
  const sha = /^corpus\/([0-9a-f]{64})\.pdf$/.exec(key)?.[1] ?? '';
  envStore ??= createObjectStoreFromEnv(serverEnv());
  return envStore.get(corpusObjectKey(sha)).then((o) => o.body);
}

/** The job body. Exported for tests. */
export async function runCorpusOcr(
  ctx: Pick<JobContext, 'log'> & { signal?: AbortSignal },
  payload: CorpusOcrPayload,
  deps: CorpusOcrDeps = {},
): Promise<CorpusOcrReport> {
  const db = deps.db ?? rootDb;
  const enabled = deps.enabled ?? serverEnv().CORPUS_OCR_ENABLED === true;
  if (!enabled) return EMPTY;
  const gateway =
    deps.gateway ??
    createPlatformAiGateway(db, {
      dailyPaise:
        deps.dailyPaise ?? serverEnv().CORPUS_OCR_DAILY_PAISE ?? DEFAULT_PLATFORM_OCR_DAILY_PAISE,
      ...(deps.now ? { now: deps.now } : {}),
    });
  const report = await drainOcrQueue(
    {
      db,
      ocr: createGatewayOcr({
        gateway,
        scope: { workspaceId: PLATFORM_AI_SCOPE },
        pipelineVersion: 'corpus-ocr-1',
        purpose: 'corpus.ocr',
        idempotencyPrefix: 'corpus-ocr',
      }),
      renderer: deps.renderer ?? mupdfRenderer,
      readBlob: deps.readBlob ?? defaultReadBlob,
      ...(deps.now ? { now: deps.now } : {}),
    },
    {
      ...DEFAULT_OCR_DRAIN_BUDGET,
      maxPages: payload.maxPages ?? DEFAULT_OCR_DRAIN_BUDGET.maxPages,
      maxBytes: payload.maxBytes ?? DEFAULT_OCR_DRAIN_BUDGET.maxBytes,
    },
    ctx.signal,
  );
  ctx.log.info({ ...report }, 'corpus.ocr done');
  return { ...report, skipped: false };
}

export const corpusOcr = defineJob({
  name: 'system.corpus.ocr',
  schema: corpusOcrSchema,
  concurrency: 1,
  singleton: { key: () => 'corpus-ocr', policy: 'stately' },
  // Every 10 minutes; a no-op while CORPUS_OCR_ENABLED is off.
  schedule: { cron: '*/10 * * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx, payload) => {
    await runCorpusOcr(ctx, payload);
  },
});
