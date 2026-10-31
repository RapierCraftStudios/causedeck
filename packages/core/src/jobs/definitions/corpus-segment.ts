// `system.corpus.segment` (#893, ADR 0051 §Segments): builds `judgment_segment` rows from the
// anonymised `redacted_text` (never `page_text`) of judgments that are redacted but not segmented, or
// whose segments were built from an older redaction or `SEGMENT_VERSION`. It runs on a schedule, so it
// follows redaction (a re-redaction changes `redaction_version`, which makes the row due again) and
// backfills existing rows; a mask request clears a judgment's segments and `segment_version` itself.
// Rows are replaced judgment by judgment in one transaction. Roles come from rules, with the optional
// resolver port for low-confidence paragraphs. Only ids and counts are logged.
import { db as rootDb, schema, type Queryable } from '@causedeck/db';
import {
  SEGMENT_VERSION,
  segmentJudgmentWithResolver,
  type RoleResolver,
} from '@causedeck/intelligence';
import { and, asc, eq, gt, isNotNull, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

const { judgment, judgmentSegment } = schema;

/** Judgments segmented per run; the rest wait for the next run, which is queued while any remain. */
export const CORPUS_SEGMENT_BATCH = 100;

export const corpusSegmentSchema = z.object({
  workspaceId: z.null().optional(),
  batch: z.number().int().min(1).max(1000).optional(),
});

export interface CorpusSegmentReport {
  segmented: number;
  segments: number;
  remaining: boolean;
}

/** `supreme_court`, `high_court` or `other`, from the court code printed in the citation. */
export function courtLevelOf(court: string): string {
  if (court === 'INSC' || court === 'SC') return 'supreme_court';
  if (/HC(-[A-Z]+)?$/.test(court)) return 'high_court';
  return 'other';
}

/** The year segments are partitioned by: the judgment date, else the citation's year, else when it was stored. */
export function judgmentYearOf(row: {
  judgmentDate: string | null;
  neutralCitation: string | null;
  createdAt: Date;
}): number {
  const fromDate = row.judgmentDate ? Number(row.judgmentDate.slice(0, 4)) : Number.NaN;
  if (Number.isInteger(fromDate) && fromDate > 1800) return fromDate;
  const cited = /^(\d{4}):/.exec(row.neutralCitation ?? '');
  if (cited?.[1]) return Number(cited[1]);
  return row.createdAt.getUTCFullYear();
}

/** The job body. Exported for tests. */
export async function runCorpusSegment(
  ctx: Pick<JobContext, 'log'>,
  payload: { batch?: number | undefined },
  deps: { db?: Queryable; resolver?: RoleResolver } = {},
): Promise<CorpusSegmentReport> {
  const db = deps.db ?? rootDb;
  const limit = payload.batch ?? CORPUS_SEGMENT_BATCH;
  const rows = await db
    .select({
      id: judgment.id,
      court: judgment.court,
      judgmentDate: judgment.judgmentDate,
      neutralCitation: judgment.neutralCitation,
      createdAt: judgment.createdAt,
      redactedText: judgment.redactedText,
      redactionVersion: judgment.redactionVersion,
    })
    .from(judgment)
    .where(
      and(
        isNotNull(judgment.redactedText),
        gt(judgment.redactionVersion, 0),
        or(
          lt(judgment.segmentVersion, SEGMENT_VERSION),
          ne(judgment.segmentedRedactionVersion, judgment.redactionVersion),
        ),
      ),
    )
    .orderBy(asc(judgment.createdAt), asc(judgment.id))
    .limit(limit);

  let total = 0;
  for (const row of rows) {
    const { segments } = await segmentJudgmentWithResolver(row.redactedText ?? [], deps.resolver);
    const year = judgmentYearOf(row);
    const courtLevel = courtLevelOf(row.court);
    await db.transaction(async (tx) => {
      await tx.delete(judgmentSegment).where(eq(judgmentSegment.judgmentId, row.id));
      if (segments.length > 0)
        await tx.insert(judgmentSegment).values(
          segments.map((s) => ({
            judgmentId: row.id,
            ordinal: s.ordinal,
            role: s.role,
            pageFrom: s.pageFrom,
            pageTo: s.pageTo,
            text: s.text,
            court: row.court,
            courtLevel,
            judgmentYear: year,
          })),
        );
      await tx
        .update(judgment)
        .set({ segmentVersion: SEGMENT_VERSION, segmentedRedactionVersion: row.redactionVersion })
        // A re-redaction that landed meanwhile keeps the row due.
        .where(and(eq(judgment.id, row.id), eq(judgment.redactionVersion, row.redactionVersion)));
    });
    total += segments.length;
  }
  ctx.log.info({ segmented: rows.length, segments: total }, 'corpus.segment: batch done');
  return { segmented: rows.length, segments: total, remaining: rows.length === limit };
}

export const corpusSegment = defineJob({
  name: 'system.corpus.segment',
  schema: corpusSegmentSchema,
  concurrency: 1,
  singleton: { key: () => 'corpus-segment', policy: 'stately' },
  // Every 10 minutes: picks up freshly redacted judgments and backfills the rest in batches.
  schedule: { cron: '*/10 * * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx, payload) => {
    await runCorpusSegment(ctx, payload);
  },
});
