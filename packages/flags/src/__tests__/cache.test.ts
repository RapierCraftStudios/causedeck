// The evaluator cache: 15 s TTL, LRU bound, and `pg_notify('flag_changed')` invalidation that makes
// a change visible to another connection's cache within 2 s (#22).
import { Secret } from '@causedeck/config/env';
import { createDb, withWorkspace, type Database } from '@causedeck/db';
import { workspaceFeatureFlag } from '@causedeck/db/schema';
import { testDatabaseUrls } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { FLAG_CACHE_TTL_MS, FlagCache, startFlagListener, type FlagListener } from '../cache.ts';
import { isEnabled, type FlagRows } from '../evaluate.ts';

describe('FlagCache', () => {
  it('expires entries after the 15 s TTL', () => {
    expect(FLAG_CACHE_TTL_MS).toBe(15_000);
    let now = 0;
    const cache = new FlagCache<string>({ now: () => now });
    cache.set('w', 'rows');
    now = 14_999;
    expect(cache.get('w')).toBe('rows');
    now = 15_000;
    expect(cache.get('w')).toBeUndefined();
  });

  it('evicts the least recently used entry past its bound', () => {
    const cache = new FlagCache<number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });
});

describe('flag_changed invalidation across connections', () => {
  const clients: Database[] = [];
  const listeners: FlagListener[] = [];
  const client = () => {
    const db = createDb({ url: new Secret(testDatabaseUrls().app), role: 'app', max: 2 });
    clients.push(db);
    return db;
  };

  afterAll(async () => {
    for (const l of listeners) await l.unlisten();
    for (const db of clients) await db.$client.end();
  });

  it('a change written by one process is visible to another within 2 s', async () => {
    const writer = client();
    const reader = client();
    // The reader's own cache, cleared only by notifications on its own connection.
    const readerCache = new FlagCache<FlagRows>();
    listeners.push(
      await startFlagListener(reader, () => {
        readerCache.clear();
      }),
    );

    // Committed data: the listener only sees committed changes.
    const { a, ua } = await seedTwoTenants(writer);
    const ctx = { workspaceId: a.id };
    const deps = { db: reader, cache: readerCache, killSwitches: {} };
    expect(await isEnabled('insights.enabled', ctx, deps)).toBe(false);
    // Cached: without a notification the reader would keep `false` for 15 s.
    expect(readerCache.size).toBe(1);

    await withWorkspace(writer, { workspaceId: a.id }, (tx) =>
      tx
        .insert(workspaceFeatureFlag)
        .values({ workspaceId: a.id, key: 'insights.enabled', enabled: true, updatedBy: ua }),
    );
    const started = performance.now();
    await expect
      .poll(() => isEnabled('insights.enabled', ctx, deps), { timeout: 2_000, interval: 50 })
      .toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);

    // Removing the override notifies too (DELETE fires the trigger).
    await withWorkspace(writer, { workspaceId: a.id }, (tx) =>
      tx.delete(workspaceFeatureFlag).where(eq(workspaceFeatureFlag.workspaceId, a.id)),
    );
    await expect
      .poll(() => isEnabled('insights.enabled', ctx, deps), { timeout: 2_000, interval: 50 })
      .toBe(false);
  });
});
