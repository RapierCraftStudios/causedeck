// Types of the news feed ingestion (#481, D-048). The fetch layer is injected as a structural
// function so this package depends on neither `@causedeck/fetch` nor core.
import type { schema } from '@causedeck/db';

export type NewsTags = schema.NewsTags;

/** The part of a governed fetch result the ingestion needs (`FetchResult` in `@causedeck/fetch`). */
export interface FeedFetchResult {
  status: number;
  body: string;
  provenance: { fetchedAt: string; sha256: string; sourceVersion: string };
}

/** `fetchSource` of a `createFetcher` instance, bound to nothing: the source is passed per call. */
export type FeedFetcher = (sourceId: string, url: string) => Promise<FeedFetchResult>;

/** One entry as the feed announced it: headline, link, date and the feed's own excerpt. */
export interface FeedEntry {
  title: string;
  url: string;
  publishedAt: Date | null;
  /** Plain text, capped; from `description`/`summary` only, never full article content. */
  excerpt: string | null;
}

/** Tags an item from its headline and excerpt. Always returns values from the closed lists. */
export interface NewsTagger {
  tag(input: { title: string; excerpt: string | null }): Promise<NewsTags>;
}

/** What is stored in `news_item`: feed-provided fields, tags and provenance, nothing else. */
export interface NewsItemInput {
  sourceId: string;
  title: string;
  url: string;
  publishedAt: Date;
  excerpt: string | null;
  tags: NewsTags;
  provenance: { sha256: string; fetchedAt: Date; sourceVersion: string };
}
