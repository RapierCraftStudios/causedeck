// `system.corpus.embed` (#895, ADR 0051 §Vectors): embeds the facts, issues, reasoning and decision
// segments of `judgment_segment` that have no vector or a vector from another model version, in
// batches through the embed gateway (India-only, cost metered in paise). A run stops at its paise
// budget and queues itself again while work remains, so the backfill resumes on the next run; a
// segment re-segmented by `system.corpus.segment` has a null embedding and is picked up the same way.
// Without a configured provider the deterministic mock serves the calls (dev, CI, staging).
// Only counts and paise are logged, never text.
import { createEmbedGateway, createMockEmbedProvider, type EmbedProvider } from '@causedeck/ai';
import { db as rootDb, type Queryable } from '@causedeck/db';
import {
  drizzleSegmentStore,
  embedDueSegments,
  type EmbedRunReport,
} from '@causedeck/intelligence';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

/** Paise a run may spend before it stops (INR 500); the next run resumes. */
export const CORPUS_EMBED_RUN_BUDGET_PAISE = 50_000;
/** Segments a run embeds at most, so it fits the job timeout. */
export const CORPUS_EMBED_RUN_SEGMENTS = 5_000;

export const corpusEmbedSchema = z.object({
  workspaceId: z.null().optional(),
  budgetPaise: z.number().int().min(1).max(10_000_000).optional(),
  maxSegments: z.number().int().min(1).max(100_000).optional(),
});

export type CorpusEmbedPayload = z.infer<typeof corpusEmbedSchema>;

export interface CorpusEmbedDeps {
  db?: Queryable;
  provider?: EmbedProvider;
  batchSize?: number;
}

/** The job body. Exported for tests. */
export async function runCorpusEmbed(
  ctx: Pick<JobContext, 'log'>,
  payload: CorpusEmbedPayload,
  deps: CorpusEmbedDeps = {},
): Promise<EmbedRunReport> {
  const db = deps.db ?? rootDb;
  const gateway = createEmbedGateway({ providers: [deps.provider ?? createMockEmbedProvider()] });
  const report = await embedDueSegments(
    drizzleSegmentStore(db),
    {
      modelVersion: () => gateway.active().modelVersion,
      embed: async (texts) => {
        const r = await gateway.embed(texts);
        return { vectors: r.vectors, costPaise: r.costPaise };
      },
    },
    {
      budgetPaise: payload.budgetPaise ?? CORPUS_EMBED_RUN_BUDGET_PAISE,
      maxSegments: payload.maxSegments ?? CORPUS_EMBED_RUN_SEGMENTS,
      ...(deps.batchSize === undefined ? {} : { batchSize: deps.batchSize }),
    },
  );
  ctx.log.info({ ...report }, 'corpus.embed: run done');
  return report;
}

export const corpusEmbed = defineJob({
  name: 'system.corpus.embed',
  schema: corpusEmbedSchema,
  concurrency: 1,
  singleton: { key: () => 'corpus-embed', policy: 'stately' },
  // Every 10 minutes: embeds new segments and backfills the rest within the per-run budget.
  schedule: { cron: '*/10 * * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx, payload) => {
    await runCorpusEmbed(ctx, payload);
  },
});
