// In-process flag cache (#22): a small LRU of each scope's flag rows with a 15 s TTL, emptied by
// `pg_notify('flag_changed')` (the 0007_flags trigger) through `LISTEN` in every server process, so
// a change is visible across processes in well under a second and at worst after the TTL.
import type { Database } from '@causedeck/db';

export const FLAG_CACHE_TTL_MS = 15_000;
export const FLAG_CACHE_MAX_ENTRIES = 1_000;
export const FLAG_CHANGED_CHANNEL = 'flag_changed';

export interface FlagCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  /** Milliseconds since an arbitrary epoch; injectable for tests. */
  now?: () => number;
}

export class FlagCache<T> {
  readonly #entries = new Map<string, { value: T; expiresAt: number }>();
  readonly #ttlMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor({
    ttlMs = FLAG_CACHE_TTL_MS,
    maxEntries = FLAG_CACHE_MAX_ENTRIES,
    now = Date.now,
  }: FlagCacheOptions = {}) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = now;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(scope: string): T | undefined {
    const entry = this.#entries.get(scope);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(scope);
      return undefined;
    }
    // Re-insert so the map's insertion order is least- to most-recently used.
    this.#entries.delete(scope);
    this.#entries.set(scope, entry);
    return entry.value;
  }

  set(scope: string, value: T): void {
    this.#entries.delete(scope);
    this.#entries.set(scope, { value, expiresAt: this.#now() + this.#ttlMs });
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}

/** Anything that can be emptied when a flag changes. */
export interface Invalidatable {
  clear(): void;
}

const caches = new Set<Invalidatable>();

/** Register a cache for `invalidateFlags`; returns the cache. */
export function registerFlagCache<C extends Invalidatable>(cache: C): C {
  caches.add(cache);
  return cache;
}

/**
 * Drop every cached evaluation. A global row change affects every workspace, so a notification
 * for any key empties the whole cache rather than guessing which scopes it touched.
 */
export function invalidateFlags(): void {
  for (const cache of caches) cache.clear();
}

export interface FlagListener {
  unlisten(): Promise<void>;
}

/**
 * `LISTEN flag_changed` on `db`'s connection pool and invalidate on every notification (and on
 * reconnect, when notifications may have been missed). Call once per server process.
 */
export async function startFlagListener(
  db: Pick<Database, '$client'>,
  onChange?: (key: string) => void,
): Promise<FlagListener> {
  const meta = await db.$client.listen(
    FLAG_CHANGED_CHANNEL,
    (key) => {
      invalidateFlags();
      onChange?.(key);
    },
    () => {
      invalidateFlags();
    },
  );
  return { unlisten: () => meta.unlisten() };
}
