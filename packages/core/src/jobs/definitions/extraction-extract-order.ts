// `extraction.extract-order` (#46): anchored extraction of a processed order or judgment, queued
// when the document pipeline emits `document.processed` for kind `order` or `judgment`. The body is
// `runOrderExtraction` in the extraction domain. Ids only in the payload; singleton per document and
// extraction version, so a replay of the event never extracts twice. Five attempts with exponential
// backoff (a gateway or database failure is retried; the model's 25 s budget is inside one attempt).
import { CAPTURE_JOB_RETRIES, CAPTURE_JOB_RETRY_DELAY_SEC } from '@causedeck/capture';
import { EXTRACTION_PIPELINE_VERSION } from '@causedeck/intelligence';
import type { AiGateway } from '@causedeck/ai';
import { z } from 'zod';

import { runOrderExtraction } from '../../extraction/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const EXTRACTION_JOB_NAME = 'extraction.extract-order';

export const extractOrderSchema = z.object({
  workspaceId: workspaceIdSchema,
  documentId: z.uuid(),
  pipelineVersion: z.string().min(1).max(64).default(EXTRACTION_PIPELINE_VERSION),
  /** Supersede the current extraction (a manual re-run). */
  reextract: z.boolean().optional(),
});

export type ExtractOrderJobPayload = z.output<typeof extractOrderSchema>;

/** Send one `extraction.extract-order` job as the registry's `enqueue` does. */
export async function enqueueExtractOrder(
  payload: z.input<typeof extractOrderSchema>,
): Promise<unknown> {
  const data = extractOrderSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(EXTRACTION_JOB_NAME, data, {
    singletonKey: `extract-order:${data.documentId}:${data.pipelineVersion}`,
    group: { id: data.workspaceId },
  });
}

/** The job body. Exported for tests. */
export async function runExtractOrderJob(
  ctx: Pick<JobContext, 'db' | 'log'>,
  payload: ExtractOrderJobPayload,
  deps: { now?: () => Date; gateway?: AiGateway; modelBudgetMs?: number } = {},
): Promise<void> {
  const result = await runOrderExtraction({ db: ctx.db, ...deps }, payload);
  if (result.outcome === 'missing') {
    throw new RetryableError('DOCUMENT_NOT_VISIBLE', 'document not visible yet');
  }
  ctx.log.info(
    {
      documentId: payload.documentId,
      outcome: result.outcome,
      ...(result.outcome === 'extracted'
        ? {
            deterministicOnly: result.deterministicOnly,
            proposals: result.proposals,
            needsYou: result.needsYou,
          }
        : {}),
      ...(result.outcome === 'skipped' ? { reason: result.reason } : {}),
    },
    'order extracted',
  );
}

export const extractOrder = defineJob({
  name: EXTRACTION_JOB_NAME,
  schema: extractOrderSchema,
  singleton: {
    key: (payload) => `extract-order:${payload.documentId}:${payload.pipelineVersion}`,
  },
  idempotencyKey: (payload) => `extract-order:${payload.documentId}:${payload.pipelineVersion}`,
  concurrency: 2,
  retry: { limit: CAPTURE_JOB_RETRIES, delaySec: CAPTURE_JOB_RETRY_DELAY_SEC, backoff: true },
  handler: async (ctx, payload) => {
    await runExtractOrderJob(ctx, payload);
  },
});
