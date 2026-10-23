import { describe, expect, it } from 'vitest';

import type { OutboxItem, OutboxStore } from '../lib/pwa/outbox/db.ts';
import {
  buildPdf,
  deletePage,
  discardSession,
  finishBatch,
  heldItems,
  jpegSize,
  recoverSessions,
  reorderPages,
  savePage,
  type SessionOptions,
} from '../lib/capture/camera/queue.ts';

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

/** The smallest bytes `jpegSize` reads: SOI, a baseline SOF0 header, padding, EOI. */
function fakeJpeg(width: number, height: number, tag = 0): Blob {
  return new Blob([
    new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      height >> 8,
      height & 255,
      width >> 8,
      width & 255,
      0x03,
      tag,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0xff,
      0xd9,
    ]),
  ]);
}

const aesKey = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

const session: SessionOptions = { batchId: 'batch-1', workspaceId: 'ws-1' };

describe('camera outbox writes', () => {
  it('stores each page encrypted and held back before any network call', async () => {
    const store = memoryStore();
    const key = await aesKey();
    const item = await savePage(store, key, session, { index: 1, photo: fakeJpeg(100, 80) });
    expect(item).toMatchObject({
      channel: 'camera',
      batchId: 'batch-1',
      hold: true,
      state: 'queued',
    });
    expect(item.encryptedBlob.byteLength).toBeGreaterThan(0);
    expect(item.mime).toBe('image/jpeg');
  });

  it('finishes a batch into one multi-page PDF in page order, sharing the batchId', async () => {
    const store = memoryStore();
    const key = await aesKey();
    for (const [index, tag] of [
      [1, 1],
      [2, 2],
      [3, 3],
    ] as const) {
      await savePage(store, key, session, { index, photo: fakeJpeg(100 + index, 80, tag) });
    }
    await reorderPages(store, session, [3, 1, 2]);
    expect(heldItems([...store.rows.values()], 'batch-1').map((i) => i.name)).toEqual([
      'page-001.jpg',
      'page-002.jpg',
      'page-003.jpg',
    ]);
    const done = await finishBatch(store, key, session);
    const rows = [...store.rows.values()];
    expect(rows).toHaveLength(1);
    expect(done).toMatchObject({ channel: 'camera', batchId: 'batch-1', mime: 'application/pdf' });
    expect(done.hold).toBeUndefined();
    const pdf = new TextDecoder('latin1').decode(
      new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: done.iv }, key, done.encryptedBlob),
      ),
    );
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 3');
    // Page order is the reordered order: the widths 103, 101, 102 appear in that order.
    const widths = [...pdf.matchAll(/\/Width (\d+)/g)].map((m) => Number(m[1]));
    expect(widths).toEqual([103, 101, 102]);
  });

  it('uploads originals only when kept', async () => {
    const key = await aesKey();
    for (const keep of [false, true]) {
      const store = memoryStore();
      await savePage(store, key, session, {
        index: 1,
        photo: fakeJpeg(100, 80),
        original: fakeJpeg(400, 300),
      });
      await finishBatch(store, key, session, { keepOriginals: keep });
      const rows = [...store.rows.values()];
      expect(rows.some((r) => r.name.startsWith('original-'))).toBe(keep);
      expect(rows.every((r) => r.hold !== true)).toBe(true);
    }
  });

  it('recovers a session lost to a tab crash and drops the leftovers of a finished one', async () => {
    const store = memoryStore();
    const key = await aesKey();
    await savePage(store, key, session, { index: 1, photo: fakeJpeg(100, 80) });
    await savePage(store, key, session, { index: 2, photo: fakeJpeg(100, 80) });
    const crashed = await recoverSessions(store);
    expect(crashed).toHaveLength(1);
    expect(crashed[0]?.pages.map((p) => p.name)).toEqual(['page-001.jpg', 'page-002.jpg']);

    // A held page of a batch whose PDF is already stored is a leftover: dropped.
    const other: SessionOptions = { batchId: 'batch-2', workspaceId: 'ws-1' };
    await savePage(store, key, other, { index: 1, photo: fakeJpeg(100, 80) });
    const pdf = [...store.rows.values()].find((r) => r.batchId === 'batch-2');
    await store.put({ ...(pdf as OutboxItem), id: 'pdf-2', name: 'x.pdf', hold: undefined });
    const again = await recoverSessions(store);
    expect(again.map((s) => s.batchId)).toEqual(['batch-1']);
  });

  it('deletes a page and discards a session', async () => {
    const store = memoryStore();
    const key = await aesKey();
    await savePage(store, key, session, { index: 1, photo: fakeJpeg(100, 80) });
    await savePage(store, key, session, { index: 2, photo: fakeJpeg(100, 80) });
    await deletePage(store, session, 1);
    expect([...store.rows.values()].map((r) => r.name)).toEqual(['page-002.jpg']);
    await discardSession(store, 'batch-1');
    expect(store.rows.size).toBe(0);
  });
});

describe('pdf', () => {
  it('reads JPEG sizes and writes one page object per JPEG', async () => {
    const bytes = new Uint8Array(await fakeJpeg(120, 90).arrayBuffer());
    expect(jpegSize(bytes)).toEqual({ width: 120, height: 90 });
    const pdf = new TextDecoder('latin1').decode(buildPdf([bytes, bytes]));
    expect(pdf).toContain('/Count 2');
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(() => jpegSize(new Uint8Array([1, 2, 3]))).toThrow('not_a_jpeg');
  });
});
