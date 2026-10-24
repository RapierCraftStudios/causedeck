// The legal news digest's feed ingestion (#481, D-048).
export { decodeEntities, toExcerpt, toTitle } from './excerpt.ts';
export { FeedFetchFailed, ingestFeed, type IngestFeedOptions } from './ingest.ts';
export { parseFeed } from './parse.ts';
export { closedTags, createGatewayNewsTagger, createKeywordTagger } from './tag.ts';
export type {
  FeedEntry,
  FeedFetchResult,
  FeedFetcher,
  NewsItemInput,
  NewsTagger,
  NewsTags,
} from './types.ts';
