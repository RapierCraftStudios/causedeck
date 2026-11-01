// ETag/hash page cache (#492): an unchanged page is not fetched again inside its freshness window,
// and a stale page is revalidated with its ETag (when the source gives one) or compared by hash.
import { createHash } from 'node:crypto';

export interface CachedPage {
  status: number;
  body: string;
  contentType: string;
  sha256: string;
  etag: string | null;
  fetchedAt: number;
  freshUntil: number;
}

export type CacheLookup =
  { state: 'fresh'; entry: CachedPage } | { state: 'stale'; entry: CachedPage } | { state: 'miss' };

export interface PageCache {
  lookup(url: string): CacheLookup;
  /** Store a page; `changed` is false when its hash equals the cached one (the window is extended). */
  store(
    url: string,
    page: { status: number; body: string; contentType: string; etag?: string | null },
    freshnessMs?: number,
  ): { changed: boolean; entry: CachedPage };
  /** The source answered 304: keep the body and open a new window. */
  touch(url: string, freshnessMs?: number): CachedPage | null;
  size(): number;
}

export const DEFAULT_FRESHNESS_MS = 6 * 3_600_000;
export const DEFAULT_CACHE_ENTRIES = 5_000;

export const hashBody = (body: string): string => createHash('sha256').update(body).digest('hex');

export function createPageCache(options: {
  now: () => number;
  freshnessMs?: number;
  maxEntries?: number;
}): PageCache {
  const entries = new Map<string, CachedPage>();
  const defaultFreshness = options.freshnessMs ?? DEFAULT_FRESHNESS_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_CACHE_ENTRIES;

  const put = (url: string, entry: CachedPage): void => {
    entries.delete(url);
    entries.set(url, entry);
    // Map keeps insertion order: the first key is the least recently written.
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      entries.delete(oldest.value);
    }
  };

  return {
    lookup(url) {
      const entry = entries.get(url);
      if (entry === undefined) return { state: 'miss' };
      return { state: entry.freshUntil > options.now() ? 'fresh' : 'stale', entry };
    },
    store(url, page, freshnessMs = defaultFreshness) {
      const now = options.now();
      const sha256 = hashBody(page.body);
      const previous = entries.get(url);
      const entry: CachedPage = {
        status: page.status,
        body: page.body,
        contentType: page.contentType,
        sha256,
        etag: page.etag ?? previous?.etag ?? null,
        fetchedAt: now,
        freshUntil: now + freshnessMs,
      };
      put(url, entry);
      return { changed: previous?.sha256 !== sha256, entry };
    },
    touch(url, freshnessMs = defaultFreshness) {
      const previous = entries.get(url);
      if (previous === undefined) return null;
      const now = options.now();
      const entry = { ...previous, fetchedAt: now, freshUntil: now + freshnessMs };
      put(url, entry);
      return entry;
    },
    size: () => entries.size,
  };
}
