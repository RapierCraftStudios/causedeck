// `system.corpus.redact` (#892, D-053): re-redact judgments whose `redaction_version` is below the
// current `REDACTION_VERSION`, in batches, from the stored `page_text`: nothing is fetched. A
// judgment under a mask request keeps its mask (`mask_reason` of `mask_request:*`), and its request
// names are applied again. Raw `page_text` and `sha256` are never written. Only ids and counts are logged.
import { db as rootDb, schema, type Queryable } from '@causedeck/db';
import { redactJudgment, REDACTION_VERSION } from '@causedeck/intelligence';
import { and, asc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

const { judgment, corpusMaskRequest } = schema;

/** Judgments re-redacted per run; the rest wait for the next run, which is queued while any remain. */
export const CORPUS_REDACT_BATCH = 200;

export const corpusRedactSchema = z.object({
  workspaceId: z.null().optional(),
  batch: z.number().int().min(1).max(2000).optional(),
});

export interface CorpusRedactReport {
  redacted: number;
  remaining: boolean;
}

/** The job body. Exported for tests. */
export async function runCorpusRedact(
  ctx: Pick<JobContext, 'log'>,
  payload: { batch?: number | undefined },
  deps: { db?: Queryable } = {},
): Promise<CorpusRedactReport> {
  const db = deps.db ?? rootDb;
  const limit = payload.batch ?? CORPUS_REDACT_BATCH;
  const rows = await db
    .select({
      id: judgment.id,
      pageText: judgment.pageText,
      bench: judgment.bench,
      maskReason: judgment.maskReason,
    })
    .from(judgment)
    .where(lt(judgment.redactionVersion, REDACTION_VERSION))
    .orderBy(asc(judgment.createdAt), asc(judgment.id))
    .limit(limit);

  const maskedIds = rows.filter((r) => r.maskReason?.startsWith('mask_request:')).map((r) => r.id);
  const names = new Map<string, string[]>();
  if (maskedIds.length > 0) {
    const requests = await db
      .select({ judgmentId: corpusMaskRequest.judgmentId, names: corpusMaskRequest.names })
      .from(corpusMaskRequest)
      .where(
        and(inArray(corpusMaskRequest.judgmentId, maskedIds), eq(corpusMaskRequest.status, 'applied')),
      );
    for (const r of requests) names.set(r.judgmentId, [...(names.get(r.judgmentId) ?? []), ...r.names]);
  }

  for (const row of rows) {
    const forced = row.maskReason?.startsWith('mask_request:') ? row.maskReason : null;
    const out = redactJudgment({
      pages: row.pageText,
      bench: row.bench,
      extraNames: names.get(row.id) ?? [],
      forceMask: forced === null ? undefined : { reason: forced },
    });
    await db
      .update(judgment)
      .set({
        redactedText: out.pages,
        caseTitle: out.caseTitle,
        titleMasked: out.titleMasked,
        redactionVersion: out.redactionVersion,
        sensitiveCategory: out.sensitiveCategory,
        maskReason: out.maskReason,
      })
      .where(eq(judgment.id, row.id));
  }
  ctx.log.info({ redacted: rows.length, version: REDACTION_VERSION }, 'corpus.redact: batch done');
  return { redacted: rows.length, remaining: rows.length === limit };
}

export const corpusRedact = defineJob({
  name: 'system.corpus.redact',
  schema: corpusRedactSchema,
  concurrency: 1,
  singleton: { key: () => 'corpus-redact', policy: 'stately' },
  // No schedule: queued by staff after a REDACTION_VERSION bump.
  timeoutSec: 3600,
  handler: async (ctx, payload) => {
    await runCorpusRedact(ctx, payload);
  },
});
