// Feed ingestion (#481, D-048): fetch one registered feed through the governed fetch layer, read
// its entries and tag them. Only feed-provided fields leave this function (headline, link, date,
// capped excerpt) with the provenance of the fetch; there is no field for an article body.
import { parseFeed } from './parse.ts';
import { createKeywordTagger } from './tag.ts';
import type { FeedFetcher, NewsItemInput, NewsTagger } from './types.ts';

export interface IngestFeedOptions {
  sourceId: string;
  feedUrl: string;
  fetchSource: FeedFetcher;
  tagger?: NewsTagger;
  /** Entries per poll; a feed's tail is skipped. */
  limit?: number;
}

export class FeedFetchFailed extends Error {
  readonly code = 'NEWS_FEED_FAILED' as const;
  constructor(
    readonly sourceId: string,
    readonly status: number,
  ) {
    super(`News feed of source ${sourceId} answered ${String(status)}`);
    this.name = 'FeedFetchFailed';
  }
}

export async function ingestFeed(options: IngestFeedOptions): Promise<NewsItemInput[]> {
  const { sourceId, feedUrl, fetchSource, tagger = createKeywordTagger(), limit = 50 } = options;
  const result = await fetchSource(sourceId, feedUrl);
  if (result.status < 200 || result.status >= 300) throw new FeedFetchFailed(sourceId, result.status);
  const fetchedAt = new Date(result.provenance.fetchedAt);
  const seen = new Set<string>();
  const items: NewsItemInput[] = [];
  for (const entry of parseFeed(result.body)) {
    if (items.length >= limit) break;
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    items.push({
      sourceId,
      title: entry.title,
      url: entry.url,
      publishedAt: entry.publishedAt ?? fetchedAt,
      excerpt: entry.excerpt,
      tags: await tagger.tag({ title: entry.title, excerpt: entry.excerpt }),
      provenance: {
        sha256: result.provenance.sha256,
        fetchedAt,
        sourceVersion: result.provenance.sourceVersion,
      },
    });
  }
  return items;
}
