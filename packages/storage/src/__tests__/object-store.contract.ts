// The shared `ObjectStore` contract (#21): every provider must pass the same suite, so the memory
// fake and MinIO/S3 stay swappable.
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { objectKey, type ObjectKey } from '../keys.ts';
import { ObjectTooLargeError } from '../limits.ts';
import { ObjectNotFoundError, SIGNED_URL_TTL_SECONDS, type ObjectStore } from '../provider.ts';

export interface ContractHarness {
  store: ObjectStore;
  /** Set the clock the store signs URLs with (the provider's `now` option). */
  setNow: (now: Date) => void;
  /** PUT `body` to a signed URL with `contentType`; returns the HTTP-like status. */
  upload: (url: string, body: Uint8Array, contentType: string) => Promise<number>;
  /** GET a signed URL; returns the status and body. */
  download: (url: string) => Promise<{ status: number; body?: Uint8Array }>;
}

const bytes = (text: string) => new TextEncoder().encode(text);

export function objectStoreContract(name: string, harness: () => ContractHarness): void {
  describe(`ObjectStore contract: ${name}`, () => {
    const ws = () => randomUUID();
    const keyIn = (workspaceId: string, kind: 'document' | 'image' = 'document'): ObjectKey =>
      objectKey({ workspaceId, kind, id: randomUUID() });

    it('put, head, get and delete an object', async () => {
      const { store } = harness();
      const key = keyIn(ws());

      expect(await store.head(key)).toBeNull();
      await store.put({ key, body: bytes('hello'), contentType: 'text/plain' });

      expect(await store.head(key)).toMatchObject({ key, size: 5, contentType: 'text/plain' });
      const got = await store.get(key);
      expect(new TextDecoder().decode(got.body)).toBe('hello');
      expect(got.meta).toMatchObject({ key, size: 5, contentType: 'text/plain' });

      await store.delete(key);
      expect(await store.head(key)).toBeNull();
      await expect(store.get(key)).rejects.toBeInstanceOf(ObjectNotFoundError);
      await expect(store.delete(key)).resolves.toBeUndefined();
    });

    it('lists only the workspace (and kind) asked for', async () => {
      const { store } = harness();
      const a = ws();
      const b = ws();
      const doc = keyIn(a);
      const img = keyIn(a, 'image');
      const other = keyIn(b);
      for (const key of [doc, img, other]) {
        await store.put({ key, body: bytes('x'), contentType: 'application/octet-stream' });
      }

      expect((await store.list(a)).map((o) => o.key).sort()).toEqual([doc, img].sort());
      expect((await store.list(a, { kind: 'image' })).map((o) => o.key)).toEqual([img]);
      expect((await store.list(b)).map((o) => o.key)).toEqual([other]);
      await expect(store.list('../')).rejects.toThrow();
    });

    it('refuses unvalidated keys at the provider boundary', async () => {
      const { store } = harness();
      const forged = `ws/${ws()}/../x` as ObjectKey;
      await expect(
        store.put({ key: forged, body: bytes('x'), contentType: 'text/plain' }),
      ).rejects.toThrow();
      await expect(store.presignGet(forged)).rejects.toThrow();
      await expect(
        store.presignPut({ key: forged, contentType: 'text/plain', contentLength: 1 }),
      ).rejects.toThrow();
    });

    it('enforces the size cap of the key kind when signing an upload', async () => {
      const { store } = harness();
      await expect(
        store.presignPut({
          key: keyIn(ws(), 'image'),
          contentType: 'image/png',
          contentLength: 25 * 1024 * 1024 + 1,
        }),
      ).rejects.toBeInstanceOf(ObjectTooLargeError);
    });

    it('signed PUT works for the exact key, type and length, and GET reads it back', async () => {
      const h = harness();
      const key = keyIn(ws());
      const body = bytes('%PDF-1.7 signed');
      const signed = await h.store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: body.byteLength,
      });

      expect(signed.method).toBe('PUT');
      expect(signed.headers).toEqual({
        'content-type': 'application/pdf',
        'content-length': String(body.byteLength),
      });
      expect(signed.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
        SIGNED_URL_TTL_SECONDS * 1000,
      );
      expect(await h.upload(signed.url, body, 'application/pdf')).toBe(200);
      expect(await h.store.head(key)).toMatchObject({ size: body.byteLength });

      const download = await h.store.presignGet(key);
      const got = await h.download(download.url);
      expect(got.status).toBe(200);
      expect(new TextDecoder().decode(got.body)).toBe('%PDF-1.7 signed');
    });

    it('signed PUT fails for a different size or content type', async () => {
      const h = harness();
      const key = keyIn(ws());
      const body = bytes('exactly this');
      const signed = await h.store.presignPut({
        key,
        contentType: 'application/pdf',
        contentLength: body.byteLength,
      });

      expect(await h.upload(signed.url, bytes('exactly this, and more'), 'application/pdf')).toBe(
        403,
      );
      expect(await h.upload(signed.url, body, 'text/html')).toBe(403);
      expect(await h.store.head(key)).toBeNull();
    });

    it('signed URLs expire after 5 minutes', async () => {
      const h = harness();
      const key = keyIn(ws());
      const body = bytes('late');
      const real = Date.now();

      h.setNow(new Date(real - (SIGNED_URL_TTL_SECONDS + 5) * 1000));
      const stale = await h.store.presignPut({
        key,
        contentType: 'text/plain',
        contentLength: body.byteLength,
      });
      h.setNow(new Date(real));
      expect(stale.expiresAt.getTime()).toBeLessThan(real);
      expect(await h.upload(stale.url, body, 'text/plain')).toBe(403);
      expect(await h.store.head(key)).toBeNull();

      h.setNow(new Date(real - (SIGNED_URL_TTL_SECONDS - 60) * 1000));
      const fresh = await h.store.presignPut({
        key,
        contentType: 'text/plain',
        contentLength: body.byteLength,
      });
      h.setNow(new Date(real));
      expect(await h.upload(fresh.url, body, 'text/plain')).toBe(200);

      h.setNow(new Date(real - (SIGNED_URL_TTL_SECONDS + 5) * 1000));
      const staleGet = await h.store.presignGet(key);
      h.setNow(new Date(real));
      expect((await h.download(staleGet.url)).status).toBe(403);
    });

    it('ping resolves for a reachable bucket', async () => {
      await expect(harness().store.ping()).resolves.toBeUndefined();
    });
  });
}
