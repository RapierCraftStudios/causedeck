// Legal news polling (#481, D-048). Two jobs:
// - `system.news.poll` runs hourly and enqueues `news.poll` for every cleared, not killed `news` or
//   `licensed` source. It has no workspace; `source` and `news_item` are global tables.
// - `news.poll` (one source) reads the source's feed through the governed fetch layer: the registry
//   decides on every call (`policyFor` fails closed), so an uncleared or killed source is skipped
//   and nothing is fetched. The feed URL is the source's `base_url`. Only feed-provided fields are
//   stored (headline, link, date, capped excerpt) with the fetch's provenance; tags come from the
//   deterministic keyword tagger because a global job has no workspace to bill an AI call to.
import { serverEnv } from '@causedeck/config/env';
import { createFetcher, createProvider, type Fetcher } from '@causedeck/fetch';
import {
  createKeywordTagger,
  FeedFetchFailed,
  ingestFeed,
  type FeedFetcher,
} from '@causedeck/intelligence';
import { z } from 'zod';

import { listNewsSourceIds, upsertNewsItems } from '../../news/index.ts';
import { createFetchLogSink, policyFor, SourceNotCleared } from '../../sources/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

export const newsPollSchema = z.object({
  workspaceId: z.null().optional(),
  sourceId: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)*$/),
});
export type NewsPollPayload = z.output<typeof newsPollSchema>;

const pollKey = (p: NewsPollPayload) => `news-poll:${p.sourceId}`;

let override: Pick<Fetcher, 'fetchSource'> | null = null;
let shared: Fetcher | undefined;

/** Test hook: replace the governed fetcher (`null` restores the env-built one). */
export function setNewsFetcher(fetcher: Pick<Fetcher, 'fetchSource'> | null): void {
  override = fetcher;
}

/**
 * The governed fetcher: the source registry decides, the AlterLab provider (the offline mock when
 * `ALTERLAB_API_KEY` is unset) reads, and every call is logged content-free in `fetch_log`. One
 * instance per process so the per-source rate limit holds across polls.
 */
function newsFetcher(ctx: Pick<JobContext, 'db'>): Pick<Fetcher, 'fetchSource'> {
  if (override !== null) return override;
  shared ??= createFetcher({
    registry: { policyFor: (id) => policyFor(id, { db: ctx.db }) },
    alterlab: createProvider({ apiKey: serverEnv().ALTERLAB_API_KEY }),
    clock: { now: () => new Date() },
    // The fetch layer has no workspace: cost is in `fetch_log`, usage keys stay with workspace callers.
    usage: { record: () => Promise.resolve() },
    log: createFetchLogSink(ctx.db),
  });
  return shared;
}

export type NewsPollOutcome = 'stored' | 'skipped';

/** Poll one source's feed and store its items. Exported for tests. */
export async function runNewsPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  { sourceId }: NewsPollPayload,
): Promise<{ outcome: NewsPollOutcome; items: number }> {
  try {
    const policy = await policyFor(sourceId, { db: ctx.db });
    const fetcher = newsFetcher(ctx);
    const fetchSource: FeedFetcher = (id, url) => fetcher.fetchSource(id, url);
    const items = await ingestFeed({
      sourceId,
      feedUrl: policy.baseUrl,
      fetchSource,
      tagger: createKeywordTagger(),
    });
    const stored = await upsertNewsItems(ctx.db, items);
    ctx.log.info({ sourceId, items: stored }, 'news feed polled');
    return { outcome: 'stored', items: stored };
  } catch (error) {
    if (error instanceof SourceNotCleared) {
      ctx.log.info({ sourceId, reason: error.reason }, 'news source not cleared; skipped');
      return { outcome: 'skipped', items: 0 };
    }
    if (error instanceof FeedFetchFailed) {
      throw new RetryableError('NEWS_POLL_RETRY', `news feed of ${sourceId} answered ${error.status}`);
    }
    if (error instanceof Error && ['FETCH_DENIED', 'FETCH_ERROR'].includes((error as { code?: string }).code ?? '')) {
      throw new RetryableError('NEWS_POLL_RETRY', `news feed of ${sourceId} failed: ${error.message}`);
    }
    throw error;
  }
}

export const newsPoll = defineJob({
  name: 'news.poll',
  schema: newsPollSchema,
  concurrency: 2,
  retry: { limit: 2, delaySec: 120, backoff: true, delayMaxSec: 1800 },
  singleton: { key: pollKey },
  handler: async (ctx, payload) => {
    await runNewsPoll(ctx, payload);
  },
});

export interface NewsPollScheduleDeps {
  enqueue?: (payload: NewsPollPayload) => Promise<unknown>;
}

async function enqueueSource(payload: NewsPollPayload): Promise<unknown> {
  const data = newsPollSchema.parse(payload);
  const sender = await getProducer();
  return sender.send('news.poll', data, { singletonKey: pollKey(data) });
}

/** Enqueue `news.poll` for every cleared news or licensed source. Exported for tests. */
export async function runNewsPollSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: NewsPollScheduleDeps = {},
): Promise<string[]> {
  const send = deps.enqueue ?? enqueueSource;
  const sourceIds = await listNewsSourceIds(ctx.db);
  for (const sourceId of sourceIds) await send({ sourceId });
  ctx.log.info({ enqueued: sourceIds.length }, 'news polls scheduled');
  return sourceIds;
}

export const systemNewsPoll = defineJob({
  name: 'system.news.poll',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'news-poll', policy: 'stately' },
  // Hourly at :10 in Asia/Kolkata.
  schedule: { cron: '10 * * * *', payload: {} },
  handler: async (ctx) => {
    await runNewsPollSchedule(ctx);
  },
});
