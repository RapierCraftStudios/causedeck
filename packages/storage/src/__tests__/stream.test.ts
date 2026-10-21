// Streamed object I/O (#301): `putStream` / `getStream` on the memory provider, the per-kind cap
// enforced while streaming, the server-only `export` kind, and `storeSystemBlobStream` (envelope
// ciphertext under the workspace DEK, plaintext sha256 and size, finalized blob row). The DB-backed
// cases run as causedeck_app in a rolled-back transaction, under FORCE row-level security.
import { createHash, randomUUID } from 'node:crypto';

import { blob } from '@causedeck/db/schema';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createMemoryObjectStore,
  decryptForWorkspace,
  EnvKeyProvider,
  findAllowedType,
  isObjectKind,
  limitStream,
  MAX_OBJECT_BYTES,
  OBJECT_KINDS,
  objectKey,
  ObjectNotFoundError,
  ObjectTooLargeError,
  storeSystemBlobStream,
} from '../index.ts';

import { collect, newKek, newWorkspace } from './workspace-fixtures.ts';

const WS = '8d1f6a52-3c1b-4f7e-9a51-2b6c0e4d9f10';
const keys = new EnvKeyProvider([newKek('kek-1')]);

async function* chunks(count: number, size: number, fill = 7): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve();
    yield new Uint8Array(size).fill((fill + i) % 256);
  }
}

describe('streamed object I/O', () => {
  it('round-trips a body through putStream and getStream in chunks', async () => {
    const store = createMemoryObjectStore();
    const key = objectKey({ workspaceId: WS, kind: 'export', id: randomUUID() });
    const { size } = await store.putStream({
      key,
      body: chunks(10, 100_000),
      contentType: 'application/octet-stream',
    });
    expect(size).toBe(1_000_000);

    const { body, meta } = await store.getStream(key);
    expect(meta.size).toBe(1_000_000);
    const parts: number[] = [];
    const all: Buffer[] = [];
    for await (const part of body) {
      parts.push(part.byteLength);
      all.push(Buffer.from(part));
    }
    expect(Math.max(...parts)).toBeLessThanOrEqual(64 * 1024);
    expect(Buffer.concat(all)).toEqual(await collect(chunks(10, 100_000)));
  });

  it('getStream of a missing key rejects with ObjectNotFoundError', async () => {
    const store = createMemoryObjectStore();
    const key = objectKey({ workspaceId: WS, kind: 'export', id: randomUUID() });
    await expect(store.getStream(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
  });

  it('stops a stream as soon as it passes the kind cap and stores nothing', async () => {
    const store = createMemoryObjectStore();
    const key = objectKey({ workspaceId: WS, kind: 'image', id: randomUUID() });
    const mb = 1024 * 1024;
    await expect(
      store.putStream({ key, body: chunks(26, mb), contentType: 'image/png' }),
    ).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(await store.head(key)).toBeNull();
  });

  it('limitStream reports the total and throws past the cap', async () => {
    let total = -1;
    expect(await collect(limitStream('export', chunks(3, 10), (n) => (total = n)))).toHaveLength(
      30,
    );
    expect(total).toBe(30);
    await expect(
      collect(limitStream('image', chunks(1, MAX_OBJECT_BYTES.image + 1), () => undefined)),
    ).rejects.toBeInstanceOf(ObjectTooLargeError);
  });

  it('keeps export a server-only kind: valid in keys, never uploadable', () => {
    expect(isObjectKind('export')).toBe(true);
    expect(OBJECT_KINDS).not.toContain('export');
    expect(findAllowedType('export', 'x.zip', 'application/zip')).toBeNull();
  });
});

describe('storeSystemBlobStream', () => {
  it('encrypts the stream, records plaintext size and sha256, and decrypts back', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const store = createMemoryObjectStore();
      const at = new Date('2026-10-20T06:00:00Z');
      const plaintext = await collect(chunks(5, 300_000, 3));

      const stored = await storeSystemBlobStream(
        { db: tx, store, keys, workspaceId: ws, now: () => at },
        {
          kind: 'export',
          filename: 'causedeck-export.zip',
          mime: 'application/zip',
          body: chunks(5, 300_000, 3),
        },
      );

      expect(stored.key).toBe(`ws/${ws}/export/2026/${stored.blobId}`);
      expect(stored.size).toBe(plaintext.byteLength);
      expect(stored.sha256).toBe(createHash('sha256').update(plaintext).digest('hex'));
      const { body } = await store.getStream(stored.key);
      const cipher = await collect(body);
      expect(cipher.subarray(0, 4).toString('ascii')).toBe('CDE1');
      expect(await collect(decryptForWorkspace(tx, keys, ws, [cipher]))).toEqual(plaintext);

      const [row] = await inWorkspace(tx, ws, (s) =>
        s.select().from(blob).where(eq(blob.id, stored.blobId)),
      );
      expect(row).toMatchObject({
        kind: 'export',
        size: plaintext.byteLength,
        sha256: stored.sha256,
        scanStatus: 'skipped',
        createdBy: null,
        finalizedAt: at,
      });
    });
  });

  it('deletes the object and writes no row when the source fails midway', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const store = createMemoryObjectStore();
      async function* failing(): AsyncGenerator<Uint8Array> {
        yield await Promise.resolve(new Uint8Array(10));
        throw new Error('source broke');
      }
      await expect(
        storeSystemBlobStream(
          { db: tx, store, keys, workspaceId: ws },
          { kind: 'export', filename: 'x.zip', mime: 'application/zip', body: failing() },
        ),
      ).rejects.toThrow('source broke');
      expect(await store.list(ws)).toEqual([]);
      const rows = await inWorkspace(tx, ws, (s) => s.select().from(blob));
      expect(rows).toEqual([]);
    });
  });
});
