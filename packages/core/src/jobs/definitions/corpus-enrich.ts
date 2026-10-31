// `system.corpus.enrich` (#894, ADR 0051 §Enrichment): builds the facets of a judgment from its
// anonymised `redacted_text` and its decision segment: the statute sections it cites (with page), the
// cases it cites (citation strings only, resolved to corpus rows when they are neutral citations), its
// subject areas (through the optional resolver port) and its outcome with an anchor. Judgments are due
// once redacted and segmented, until `enrich_version` reaches the version being run or a re-redaction
// lands. A run replaces only the rows of its own version (`ruleset_version`, `model_version`), in one
// transaction per judgment, so a new version can be run beside the old. Only ids and counts are logged.
import { db as rootDb, schema, type Queryable } from '@causedeck/db';
import {
  ENRICH_VERSION,
  extractCitations,
  extractOutcome,
  extractStatuteRefs,
  isNeutralCitation,
  rulesetVersion,
  tagSubjects,
  SUBJECT_TEXT_CHARS,
  type SubjectResolver,
} from '@causedeck/intelligence';
import { and, asc, eq, gt, inArray, isNotNull, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

import { courtLevelOf } from './corpus-segment.ts';

const { judgment, judgmentSegment, judgmentStatuteRef, judgmentCitationRef, judgmentTag } = schema;

/** Judgments enriched per run; the rest wait for the next run. */
export const CORPUS_ENRICH_BATCH = 50;

export const corpusEnrichSchema = z.object({
  workspaceId: z.null().optional(),
  batch: z.number().int().min(1).max(1000).optional(),
});

export interface CorpusEnrichReport {
  enriched: number;
  statuteRefs: number;
  citations: number;
  tags: number;
  remaining: boolean;
}

/** The job body. Exported for tests. */
export async function runCorpusEnrich(
  ctx: Pick<JobContext, 'log'>,
  payload: { batch?: number | undefined },
  deps: { db?: Queryable; resolver?: SubjectResolver; version?: number } = {},
): Promise<CorpusEnrichReport> {
  const db = deps.db ?? rootDb;
  const version = deps.version ?? ENRICH_VERSION;
  const ruleset = rulesetVersion(version);
  const limit = payload.batch ?? CORPUS_ENRICH_BATCH;
  const rows = await db
    .select({
      id: judgment.id,
      court: judgment.court,
      neutralCitation: judgment.neutralCitation,
      redactedText: judgment.redactedText,
      redactionVersion: judgment.redactionVersion,
    })
    .from(judgment)
    .where(
      and(
        isNotNull(judgment.redactedText),
        gt(judgment.redactionVersion, 0),
        // Segments must exist for the current redaction: the outcome is read from them.
        gt(judgment.segmentVersion, 0),
        eq(judgment.segmentedRedactionVersion, judgment.redactionVersion),
        or(
          lt(judgment.enrichVersion, version),
          ne(judgment.enrichedRedactionVersion, judgment.redactionVersion),
        ),
      ),
    )
    .orderBy(asc(judgment.createdAt), asc(judgment.id))
    .limit(limit);

  const totals = { statuteRefs: 0, citations: 0, tags: 0 };
  for (const row of rows) {
    const pages = row.redactedText ?? [];
    const segments = await db
      .select({
        role: judgmentSegment.role,
        pageFrom: judgmentSegment.pageFrom,
        pageTo: judgmentSegment.pageTo,
        text: judgmentSegment.text,
      })
      .from(judgmentSegment)
      .where(eq(judgmentSegment.judgmentId, row.id))
      .orderBy(asc(judgmentSegment.ordinal));
    const statutes = extractStatuteRefs(pages);
    const citations = extractCitations(pages).filter((c) => c.normalised !== row.neutralCitation);
    const neutral = citations.filter((c) => isNeutralCitation(c.normalised)).map((c) => c.normalised);
    const resolved = new Map<string, string>();
    if (neutral.length > 0) {
      const cited = await db
        .select({ id: judgment.id, neutralCitation: judgment.neutralCitation })
        .from(judgment)
        .where(and(inArray(judgment.neutralCitation, neutral), ne(judgment.id, row.id)));
      for (const c of cited) if (c.neutralCitation !== null) resolved.set(c.neutralCitation, c.id);
    }
    const outcome = extractOutcome(segments, pages);
    // The subject text is the redacted facts, issues and decision, never `page_text`.
    const subjectText = segments
      .filter((s) => ['facts', 'issues', 'decision'].includes(s.role))
      .map((s) => s.text)
      .join('\n\n')
      .slice(0, SUBJECT_TEXT_CHARS);
    const tags =
      deps.resolver === undefined || subjectText === ''
        ? null
        : await tagSubjects(subjectText, deps.resolver).catch(() => null);

    await db.transaction(async (tx) => {
      await tx
        .delete(judgmentStatuteRef)
        .where(
          and(eq(judgmentStatuteRef.judgmentId, row.id), eq(judgmentStatuteRef.rulesetVersion, ruleset)),
        );
      if (statutes.length > 0)
        await tx.insert(judgmentStatuteRef).values(
          statutes.map((s) => ({
            judgmentId: row.id,
            statute: s.statute,
            section: s.section,
            page: s.page,
            rulesetVersion: ruleset,
          })),
        );
      await tx
        .delete(judgmentCitationRef)
        .where(
          and(
            eq(judgmentCitationRef.judgmentId, row.id),
            eq(judgmentCitationRef.rulesetVersion, ruleset),
          ),
        );
      if (citations.length > 0)
        await tx.insert(judgmentCitationRef).values(
          citations.map((c) => ({
            judgmentId: row.id,
            rawCitation: c.raw,
            normalisedCitation: c.normalised,
            citedJudgmentId: resolved.get(c.normalised) ?? null,
            page: c.page,
            rulesetVersion: ruleset,
          })),
        );
      // An unusable or absent resolver reply leaves the existing tags alone.
      if (tags !== null && deps.resolver !== undefined) {
        await tx
          .delete(judgmentTag)
          .where(
            and(eq(judgmentTag.judgmentId, row.id), eq(judgmentTag.modelVersion, deps.resolver.version)),
          );
        if (tags.length > 0)
          await tx.insert(judgmentTag).values(
            tags.map((t) => ({
              judgmentId: row.id,
              subjectArea: t.area,
              confidence: t.confidence,
              modelVersion: deps.resolver?.version ?? '',
            })),
          );
      }
      await tx
        .update(judgment)
        .set({
          courtLevel: courtLevelOf(row.court),
          outcome: outcome.outcome,
          outcomeAnchor: outcome.anchor,
          enrichVersion: version,
          enrichedRedactionVersion: row.redactionVersion,
        })
        // A re-redaction that landed meanwhile keeps the row due.
        .where(and(eq(judgment.id, row.id), eq(judgment.redactionVersion, row.redactionVersion)));
    });
    totals.statuteRefs += statutes.length;
    totals.citations += citations.length;
    totals.tags += tags?.length ?? 0;
  }
  ctx.log.info({ enriched: rows.length, ...totals }, 'corpus.enrich: batch done');
  return { enriched: rows.length, ...totals, remaining: rows.length === limit };
}

export const corpusEnrich = defineJob({
  name: 'system.corpus.enrich',
  schema: corpusEnrichSchema,
  concurrency: 1,
  singleton: { key: () => 'corpus-enrich', policy: 'stately' },
  // Every 10 minutes, offset from the segment job it follows: new facets and the backfill in batches.
  schedule: { cron: '5-59/10 * * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx, payload) => {
    await runCorpusEnrich(ctx, payload);
  },
});
