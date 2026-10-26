import type { Block } from '@causedeck/validators/drafting';
import { describe, expect, it } from 'vitest';

import {
  cacheDraft,
  flushDraftEdits,
  pendingDraftEdits,
  queueDraftEdit,
  readCachedDraft,
  type DraftEditStore,
} from '../../../lib/pwa/outbox/draft-edits.ts';

function memory() {
  const cache = new Map<string, never>();
  const queue = new Map<string, never>();
  const store = {
    getCache: (id: string) => Promise.resolve(cache.get(id)),
    putCache: (row: { id: string }) => Promise.resolve(void cache.set(row.id, row as never)),
    queue: () => Promise.resolve([...queue.values()]),
    getQueued: (id: string) => Promise.resolve(queue.get(id)),
    putQueued: (row: { id: string }) => Promise.resolve(void queue.set(row.id, row as never)),
    removeQueued: (id: string) => Promise.resolve(void queue.delete(id)),
  } as unknown as DraftEditStore;
  let key: CryptoKey | undefined;
  const keys = {
    get: () => Promise.resolve(key),
    put: (k: CryptoKey) => Promise.resolve(void (key = k)),
  };
  return { store, keys, queue };
}

const blocks: Block[] = [{ type: 'paragraph', text: 'Secret strategy text' }];
const edit = (base = 3, text = 'x') => ({
  workspaceId: 'w',
  draftId: 'd',
  baseVersionNo: base,
  blocks: [{ type: 'paragraph', text }] as Block[],
  diffs: [{ blockKey: 'n', before: 'a', after: text }],
});

describe('draft edit cache and queue', () => {
  it('round-trips the cache and never stores plaintext', async () => {
    const { store, keys } = memory();
    await cacheDraft(store, keys, { workspaceId: 'w', draftId: 'd', title: 'T', versionNo: 2, blocks });
    const row = await store.getCache('w:d');
    expect(new TextDecoder().decode(row?.encryptedBlob)).not.toContain('Secret');
    expect((await readCachedDraft(store, keys, 'w', 'd'))?.blocks).toEqual(blocks);
    expect(await readCachedDraft(store, keys, 'w', 'other')).toBeUndefined();
  });

  it('keeps one row per draft, the oldest base and every diff', async () => {
    const { store, keys, queue } = memory();
    await queueDraftEdit(store, keys, edit(3, 'one'));
    await queueDraftEdit(store, keys, edit(4, 'two'));
    expect(queue.size).toBe(1);
    expect(await pendingDraftEdits(store, 'w')).toBe(1);
    const seen: { base: number; n: number; text: string }[] = [];
    await flushDraftEdits(store, keys, (e) => {
      seen.push({ base: e.baseVersionNo, n: e.diffs.length, text: (e.blocks[0] as { text: string }).text });
      return Promise.resolve({ ok: true });
    });
    expect(seen).toEqual([{ base: 3, n: 2, text: 'two' }]);
    expect(await pendingDraftEdits(store)).toBe(0);
  });

  it('flushes: conflicts stay and are not retried, transient failures retry', async () => {
    const { store, keys } = memory();
    await queueDraftEdit(store, keys, edit());
    expect(await flushDraftEdits(store, keys, () => Promise.resolve({ ok: false, code: 'CONFLICT' }))).toEqual({
      sent: 0,
      conflicts: 1,
      failed: 0,
    });
    let calls = 0;
    await flushDraftEdits(store, keys, () => {
      calls++;
      return Promise.resolve({ ok: true });
    });
    expect(calls).toBe(0);
    expect(await pendingDraftEdits(store)).toBe(0);

    await queueDraftEdit(store, keys, { ...edit(), draftId: 'e' });
    expect((await flushDraftEdits(store, keys, () => Promise.reject(new Error('offline')))).failed).toBe(1);
    expect(await pendingDraftEdits(store)).toBe(1);
  });
});
