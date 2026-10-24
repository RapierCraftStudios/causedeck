// Legal news polling (#481, D-048). Two jobs:
// - `system.news.poll` runs hourly and enqueues `system.news.poll-source` for every cleared, not killed `news` or
//   `licensed` source. It has no workspace; `source` and `news_item` are global tables.
// - `system.news.poll-source` (one source) reads the source's feed through the governed fetch layer (core never
//   imports `@causedeck/fetch`: the worker wires it through `setNewsFetcherFactory`): the registry
//   decides on every call (`policyFor` fails closed), so an uncleared or killed source is skipped
//   and nothing is fetched. The feed URL is the source's `base_url`. Only feed-provided fields are
//   stored (headline, link, date, capped excerpt) with the fetch's provenance; tags come from the
//   deterministic keyword tagger because a global job has no workspace to bill an AI call to.
import {
  createKeywordTagger,
  FeedFetchFailed,
  ingestFeed,
  type FeedFetcher,
} from '@causedeck/intelligence';
import { z } from 'zod';

import { listNewsSourceIds, upsertNewsItems } from '../../news/index.ts';
import { policyFor, SourceNotCleared } from '../../sources/index.ts';
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

/** The governed fetch the poll needs, structurally `Fetcher.fetchSource` of `@causedeck/fetch`, which core does not import. */
export interface NewsFetcher {
  fetchSource: FeedFetcher;
}

/** Builds the governed fetcher for one poll from the job's db (the worker supplies it at startup). */
export type NewsFetcherFactory = (db: JobContext['db']) => NewsFetcher;

let fetcherFactory: NewsFetcherFactory | null = null;

/** Wiring point: the worker passes a factory over `@causedeck/fetch`; `null` unwires it (tests). */
export function setNewsFetcherFactory(factory: NewsFetcherFactory | null): void {
  fetcherFactory = factory;
}

/** Without a wired fetcher a poll fails loudly rather than reaching a feed any other way. */
const unwiredFetcher: NewsFetcher = {
  fetchSource: () =>
    Promise.reject(new Error('news poll: no fetcher wired (setNewsFetcherFactory)')),
};

export type NewsPollOutcome = 'stored' | 'skipped';

/** Poll one source's feed and store its items. Exported for tests. */
export async function runNewsPoll(
  ctx: Pick<JobContext, 'db' | 'log'>,
  { sourceId }: NewsPollPayload,
): Promise<{ outcome: NewsPollOutcome; items: number }> {
  try {
    const policy = await policyFor(sourceId, { db: ctx.db });
    const fetcher = fetcherFactory?.(ctx.db) ?? unwiredFetcher;
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
      throw new RetryableError(
        'NEWS_POLL_RETRY',
        `news feed of ${sourceId} answered ${String(error.status)}`,
      );
    }
    if (
      error instanceof Error &&
      ['FETCH_DENIED', 'FETCH_ERROR'].includes((error as { code?: string }).code ?? '')
    ) {
      throw new RetryableError(
        'NEWS_POLL_RETRY',
        `news feed of ${sourceId} failed: ${error.message}`,
      );
    }
    throw error;
  }
}

export const newsPoll = defineJob({
  name: 'system.news.poll-source',
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
  return sender.send('system.news.poll-source', data, { singletonKey: pollKey(data) });
}

/** Enqueue `system.news.poll-source` for every cleared news or licensed source. Exported for tests. */
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
