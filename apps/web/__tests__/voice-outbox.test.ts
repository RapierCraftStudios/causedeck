import { describe, expect, it, vi } from 'vitest';

import { saveRecording } from '../lib/capture/voice/queue.ts';
import type { OutboxItem, OutboxStore } from '../lib/pwa/outbox/db.ts';
import { OutboxCapError } from '../lib/pwa/outbox/queue.ts';
import { uploadItem } from '../lib/pwa/outbox/uploader.ts';

function memoryStore(): OutboxStore & { rows: Map<string, OutboxItem> } {
  const rows = new Map<string, OutboxItem>();
  return {
    rows,
    all: () => Promise.resolve([...rows.values()].sort((a, b) => a.createdAt - b.createdAt)),
    get: (id) => Promise.resolve(rows.get(id)),
    put: (item) => {
      rows.set(item.id, item);
      return Promise.resolve();
    },
    remove: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
  };
}

const aesKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

const audio = () => new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: 'audio/webm;codecs=opus' });

describe('voice outbox writes (#543)', () => {
  it('stores the recording encrypted on the voice channel before any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const store = memoryStore();
    const key = await aesKey();
    const item = await saveRecording(
      store,
      key,
      { blob: audio(), mime: 'audio/webm;codecs=opus' },
      { workspaceId: 'ws-1', matterHintId: 'matter-1', now: Date.UTC(2026, 9, 23, 5, 30) },
    );
    vi.unstubAllGlobals();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(item).toMatchObject({
      channel: 'voice',
      mime: 'audio/webm',
      state: 'queued',
      workspaceId: 'ws-1',
      matterHintId: 'matter-1',
      size: 5,
    });
    expect(item.hold).toBeUndefined();
    expect(item.name).toBe('voice-2026-10-23T05-30-00-000Z.webm');
    expect(item.encryptedBlob.byteLength).toBeGreaterThan(0);
    // It survives a reload: the row is read back from the store.
    expect((await store.all()).map((row) => row.id)).toEqual([item.id]);
  });

  it('uses .m4a for a Safari recording and the declared type for the upload', async () => {
    const store = memoryStore();
    const item = await saveRecording(
      store,
      await aesKey(),
      { blob: new Blob([new Uint8Array(8)], { type: 'audio/mp4' }), mime: 'audio/mp4' },
      { workspaceId: 'ws-1' },
    );
    expect(item.name.endsWith('.m4a')).toBe(true);
    expect(item.mime).toBe('audio/mp4');
  });

  it('uploads with channel=voice when online and stays queued when the network is down', async () => {
    const store = memoryStore();
    const key = await aesKey();
    const item = await saveRecording(
      store,
      key,
      { blob: audio(), mime: 'audio/webm' },
      { workspaceId: 'ws-1' },
    );
    const offline = vi.fn().mockRejectedValue(new TypeError('offline'));
    expect(await uploadItem(item, { store, key, fetch: offline, random: () => 0 })).toBe('retry');
    const retried = (await store.get(item.id)) as OutboxItem;
    expect(retried.state).toBe('queued');

    const calls: { url: string; body?: string }[] = [];
    const online = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url === '/api/captures/presign') {
        return Promise.resolve(
          Response.json({
            captureId: 'cap-1',
            uploadUrl: 'https://store.test/put',
            headers: { 'content-type': 'audio/webm' },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    const outcome = await uploadItem(retried, {
      store,
      key,
      fetch: online as unknown as typeof fetch,
    });
    expect(outcome).toBe('sent');
    const presign = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(presign).toMatchObject({ channel: 'voice', mime: 'audio/webm', workspaceId: 'ws-1' });
  });

  it('stores nothing when the outbox is full', async () => {
    const store = memoryStore();
    await expect(
      saveRecording(
        store,
        await aesKey(),
        { blob: audio(), mime: 'audio/webm' },
        { workspaceId: 'ws-1', capBytes: 2 },
      ),
    ).rejects.toBeInstanceOf(OutboxCapError);
    expect(store.rows.size).toBe(0);
  });
});
