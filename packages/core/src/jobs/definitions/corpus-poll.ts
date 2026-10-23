// `system.corpus.poll` (#484, D-048): once a day, read each cleared `corpus` source's listing page
// through the governed fetch layer, take its same-host PDF links and ingest each one into the
// global `judgment` corpus (`ingestJudgment` dedupes by sha256, so a judgment seen again is a
// no-op). With a `sourceId` payload it polls that source only. An uncleared or killed source is
// skipped (`policyFor` throws before any network call), and with no fetcher configured the job
// does nothing: it never reads an external host except through the fetcher. Only ids, counts and
// URL hashes are logged.
import { db as rootDb, schema, type Queryable } from '@causedeck/db';
import { ingestJudgment, type CorpusFetcher } from '@causedeck/intelligence';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { policyFor, SourceNotCleared } from '../../sources/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

const { source } = schema;

/** Judgment links ingested per source and run; the rest wait for the next run. */
export const CORPUS_POLL_MAX_PER_SOURCE = 50;

export const corpusPollSchema = z.object({
  workspaceId: z.null().optional(),
  sourceId: z.string().min(1).max(200).optional(),
});

export interface CorpusPollReport {
  sources: number;
  skipped: number;
  inserted: number;
  duplicates: number;
  failed: number;
}

export interface CorpusPollDeps {
  db?: Queryable;
  fetcher?: CorpusFetcher | null;
}

let configured: CorpusFetcher | null = null;

/** The process-wide fetcher `system.corpus.poll` uses (`createFetcher` of `@causedeck/fetch`); null disables it. */
export function setCorpusFetcher(fetcher: CorpusFetcher | null): void {
  configured = fetcher;
}

/** Absolute PDF links of `html` on the same host as `base`, in order and without repeats. */
export function pdfLinks(html: string, base: string): string[] {
  const baseUrl = new URL(base);
  const links = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+?\.pdf)(?:\?[^"']*)?["']/gi)) {
    try {
      const url = new URL(match[1] ?? '', baseUrl);
      if (url.host === baseUrl.host && /^https?:$/.test(url.protocol)) links.add(url.toString());
    } catch {
      // A malformed href is not a link.
    }
  }
  return [...links];
}

/** The job body. Exported for tests. */
export async function runCorpusPoll(
  ctx: Pick<JobContext, 'log'>,
  payload: { sourceId?: string | undefined },
  deps: CorpusPollDeps = {},
): Promise<CorpusPollReport> {
  const db = deps.db ?? rootDb;
  const fetcher = deps.fetcher === undefined ? configured : deps.fetcher;
  const report: CorpusPollReport = { sources: 0, skipped: 0, inserted: 0, duplicates: 0, failed: 0 };
  if (fetcher === null) {
    ctx.log.warn({}, 'corpus.poll: no fetcher configured');
    return report;
  }
  const ids =
    payload.sourceId !== undefined
      ? [payload.sourceId]
      : (await db.select({ id: source.id }).from(source).where(eq(source.kind, 'corpus'))).map(
          (row) => row.id,
        );
  for (const sourceId of ids) {
    let baseUrl: string;
    try {
      baseUrl = (await policyFor(sourceId, { db })).baseUrl;
    } catch (error) {
      if (!(error instanceof SourceNotCleared)) throw error;
      report.skipped += 1;
      continue;
    }
    report.sources += 1;
    let links: string[];
    try {
      links = pdfLinks((await fetcher.fetchSource(sourceId, baseUrl)).body, baseUrl);
    } catch (error) {
      report.failed += 1;
      ctx.log.warn({ sourceId, error: error instanceof Error ? error.name : 'error' }, 'corpus.poll: listing failed');
      continue;
    }
    for (const url of links.slice(0, CORPUS_POLL_MAX_PER_SOURCE)) {
      try {
        const outcome = await ingestJudgment({ db, fetcher }, { sourceId, url });
        if (outcome.status === 'inserted') report.inserted += 1;
        else if (outcome.status === 'duplicate') report.duplicates += 1;
        else report.failed += 1;
      } catch (error) {
        report.failed += 1;
        ctx.log.warn({ sourceId, error: error instanceof Error ? error.name : 'error' }, 'corpus.poll: ingest failed');
      }
    }
  }
  ctx.log.info({ ...report }, 'corpus.poll done');
  return report;
}

export const corpusPoll = defineJob({
  name: 'system.corpus.poll',
  schema: corpusPollSchema,
  concurrency: 1,
  singleton: { key: (payload) => `corpus-poll:${payload.sourceId ?? 'all'}`, policy: 'stately' },
  // Daily 05:00 IST.
  schedule: { cron: '0 5 * * *', payload: {} },
  timeoutSec: 1800,
  handler: async (ctx, payload) => {
    await runCorpusPoll(ctx, payload);
  },
});
