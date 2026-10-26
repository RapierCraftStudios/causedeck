import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { deleteAllOfflineDbs } from '../../lib/offline/db.ts';
import { rememberScope } from '../../lib/offline/prefetch.ts';
import type { PushBatch } from '../../lib/offline/sync.ts';
import {
  type OutboxStorage,
  drainScope,
  enqueueOffline,
  listStuck,
  resolveConflict,
} from '../../lib/offline/use-outbox.ts';
import { OutboxItem } from '../../app/(app)/w/[slug]/_offline/outbox.ts';

const L = '00000000-0000-4000-8000-000000000001';
const P = '00000000-0000-4000-8000-0000000000b1';
const SLUG = 'chambers';
const WS = 'ws-1';

function memory(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

function storage(remember = true): OutboxStorage {
  const local = memory();
  if (remember) rememberScope(local, SLUG, { userId: 'user-a', workspaceId: WS });
  return { local, session: memory() };
}

afterEach(async () => {
  await deleteAllOfflineDbs();
});

describe('offline outbox wiring (#851)', () => {
  it('saves nothing and says so when this device has no scope for the slug', async () => {
    expect(
      await enqueueOffline(
        SLUG,
        WS,
        { kind: 'brief_note', listingId: L, note: 'n' },
        storage(false),
      ),
    ).toBe(false);
  });

  it('queues carry, note, prepared and next-date edits as items the server accepts, drained in order', async () => {
    const s = storage();
    const edits = [
      { kind: 'carry_item', carry: { listingId: L, action: 'tick', key: 'k1', ticked: true } },
      { kind: 'brief_note', listingId: L, note: 'bring the order' },
      { kind: 'brief_prepared', listingId: L, prepared: true },
      {
        kind: 'next_date',
        proceedingId: P,
        date: '2026-11-03',
        expectedCanonicalDate: '2026-10-20',
      },
    ] as const;
    for (const edit of edits) expect(await enqueueOffline(SLUG, WS, edit, s)).toBe(true);

    const seen: unknown[] = [];
    const push: PushBatch = (items) => {
      seen.push(...items);
      return Promise.resolve(
        (items as { key: string }[]).map((i) => ({ key: i.key, status: 'applied' as const })),
      );
    };
    const summary = await drainScope(SLUG, push, s);
    expect(summary).toMatchObject({ sent: 4, offline: false });
    expect(seen.map((i) => (i as { kind: string }).kind)).toEqual(edits.map((e) => e.kind));
    for (const item of seen) expect(OutboxItem.safeParse(item).success).toBe(true);
    expect(await listStuck(SLUG, s)).toEqual([]);
  });

  it('keeps edits queued while the push fails (still offline)', async () => {
    const s = storage();
    await enqueueOffline(SLUG, WS, { kind: 'brief_prepared', listingId: L, prepared: false }, s);
    const down: PushBatch = () => Promise.reject(new Error('offline'));
    expect((await drainScope(SLUG, down, s))?.offline).toBe(true);
    const up: PushBatch = (items) =>
      Promise.resolve(
        (items as { key: string }[]).map((i) => ({ key: i.key, status: 'applied' as const })),
      );
    expect((await drainScope(SLUG, up, s))?.sent).toBe(1);
  });

  it('surfaces a changed next date as a conflict entry, and resolving it either way settles it', async () => {
    const s = storage();
    const edit = {
      kind: 'next_date',
      proceedingId: P,
      date: '2026-11-03',
      expectedCanonicalDate: '2026-10-20',
    } as const;
    await enqueueOffline(SLUG, WS, edit, s);
    const conflict: PushBatch = (items) =>
      Promise.resolve(
        (items as { key: string }[]).map((i) => ({
          key: i.key,
          status: 'conflict' as const,
          serverDate: '2026-10-25',
        })),
      );
    expect(await drainScope(SLUG, conflict, s)).toMatchObject({ conflicts: 1 });
    const [entry] = await listStuck(SLUG, s);
    if (!entry) throw new Error('expected a stuck entry');
    expect(entry).toMatchObject({ state: 'conflict', serverDate: '2026-10-25' });

    // "Propose my date" requeues against the date now on file, and the next drain sends it.
    expect(await resolveConflict(SLUG, entry, 'mine', s)).toBe(true);
    expect(await listStuck(SLUG, s)).toEqual([]);
    const sent: unknown[] = [];
    await drainScope(
      SLUG,
      (items) => {
        sent.push(...items);
        return Promise.resolve(
          (items as { key: string }[]).map((i) => ({ key: i.key, status: 'applied' as const })),
        );
      },
      s,
    );
    expect(sent).toMatchObject([{ kind: 'next_date', expectedCanonicalDate: '2026-10-25' }]);

    // "Keep the date on file" drops the edit.
    await enqueueOffline(SLUG, WS, edit, s);
    await drainScope(SLUG, conflict, s);
    const [again] = await listStuck(SLUG, s);
    if (!again) throw new Error('expected a stuck entry');
    expect(await resolveConflict(SLUG, again, 'server', s)).toBe(true);
    expect(await listStuck(SLUG, s)).toEqual([]);
  });
});
