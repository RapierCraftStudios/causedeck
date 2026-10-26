import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openVault } from '../../lib/offline/crypto.ts';
import {
  type OfflineDb,
  dexieWrappedKeyStore,
  deleteAllOfflineDbs,
  openOfflineDb,
} from '../../lib/offline/db.ts';
import {
  type PushBatch,
  BATCH_SIZE,
  drainOutbox,
  enqueueEdit,
  pendingCount,
  stuckEntries,
} from '../../lib/offline/sync.ts';

const SCOPE = { userId: 'user-a', workspaceId: 'ws-1' };
const L = '00000000-0000-4000-8000-000000000001';
const P = '00000000-0000-4000-8000-0000000000b1';
const opened: OfflineDb[] = [];

async function setup() {
  const db = openOfflineDb(SCOPE);
  opened.push(db);
  const vault = await openVault(dexieWrappedKeyStore(db), 'secret');
  return { db, vault, now: () => 1000 };
}

afterEach(async () => {
  for (const db of opened.splice(0)) db.close();
  await deleteAllOfflineDbs();
});

const applyAll: PushBatch = (items) =>
  Promise.resolve(
    (items as { key: string }[]).map((i) => ({ key: i.key, status: 'applied' as const })),
  );

describe('outbox drain', () => {
  it('replays in enqueue order even with the same clock tick, then empties the outbox', async () => {
    const c = await setup();
    for (const label of ['one', 'two', 'three']) {
      await enqueueEdit(c, 'ws-1', {
        kind: 'carry_item',
        carry: { listingId: L, action: 'add', label },
      });
    }
    const seen: string[] = [];
    const push: PushBatch = (items) => {
      seen.push(...(items as { carry: { label: string } }[]).map((i) => i.carry.label));
      return applyAll(items);
    };
    const summary = await drainOutbox({ ...c, push });
    expect(seen).toEqual(['one', 'two', 'three']);
    expect(summary).toMatchObject({ sent: 3, offline: false });
    expect(await pendingCount(c)).toBe(0);
  });

  it('keeps entries on a network failure and resends the same key without duplicating', async () => {
    const c = await setup();
    const entry = await enqueueEdit(c, 'ws-1', { kind: 'brief_note', listingId: L, note: 'n' });
    const failing = vi.fn<PushBatch>().mockRejectedValue(new Error('offline'));
    expect((await drainOutbox({ ...c, push: failing })).offline).toBe(true);
    expect(await pendingCount(c)).toBe(1);

    const applied = new Set<string>();
    const push: PushBatch = (items) =>
      Promise.resolve(
        (items as { key: string }[]).map((i) => {
          const dup = applied.has(i.key);
          applied.add(i.key);
          return { key: i.key, status: dup ? ('duplicate' as const) : ('applied' as const) };
        }),
      );
    await drainOutbox({ ...c, push });
    expect(applied).toEqual(new Set([entry.key]));
    expect(await pendingCount(c)).toBe(0);
  });

  it('turns a next-date conflict into a stored conflict card and does not retry it', async () => {
    const c = await setup();
    await enqueueEdit(c, 'ws-1', {
      kind: 'next_date',
      proceedingId: P,
      date: '2030-03-01',
      expectedCanonicalDate: null,
    });
    const push: PushBatch = (items) =>
      Promise.resolve(
        (items as { key: string }[]).map((i) => ({
          key: i.key,
          status: 'conflict' as const,
          serverDate: '2030-02-01',
        })),
      );
    expect(await drainOutbox({ ...c, push })).toMatchObject({ conflicts: 1 });
    const stuck = await stuckEntries(c);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ state: 'conflict', serverDate: '2030-02-01' });
    const again = vi.fn<PushBatch>(applyAll);
    await drainOutbox({ ...c, push: again });
    expect(again).not.toHaveBeenCalled();
  });

  it('marks a rejected entry failed with its code', async () => {
    const c = await setup();
    await enqueueEdit(c, 'ws-1', { kind: 'brief_prepared', listingId: L, prepared: true });
    const push: PushBatch = (items) =>
      Promise.resolve(
        (items as { key: string }[]).map((i) => ({
          key: i.key,
          status: 'rejected' as const,
          code: 'FORBIDDEN',
        })),
      );
    expect(await drainOutbox({ ...c, push })).toMatchObject({ failed: 1 });
    expect((await stuckEntries(c))[0]).toMatchObject({ state: 'failed', code: 'FORBIDDEN' });
  });

  it('survives reopening the database and never stores plaintext', async () => {
    const c = await setup();
    await enqueueEdit(c, 'ws-1', { kind: 'brief_note', listingId: L, note: 'Rajeshwari secret' });
    const raw = JSON.stringify(await c.db.outbox.toArray(), (_k, v: unknown) =>
      v instanceof ArrayBuffer || ArrayBuffer.isView(v)
        ? Array.from(new Uint8Array(v as ArrayBuffer))
        : v,
    );
    expect(raw).not.toContain('Rajeshwari');
    c.db.close();
    const again = await setup();
    expect(await pendingCount(again)).toBe(1);
  });

  it('sends at most BATCH_SIZE items per push and joins a concurrent drain', async () => {
    const c = await setup();
    for (let i = 0; i < BATCH_SIZE + 1; i++) {
      await enqueueEdit(c, 'ws-1', { kind: 'brief_prepared', listingId: L, prepared: i % 2 === 0 });
    }
    const sizes: number[] = [];
    const push: PushBatch = (items) => {
      sizes.push(items.length);
      return applyAll(items);
    };
    const [a, b] = await Promise.all([drainOutbox({ ...c, push }), drainOutbox({ ...c, push })]);
    expect(a).toBe(b);
    expect(sizes).toEqual([BATCH_SIZE, 1]);
  });
});
