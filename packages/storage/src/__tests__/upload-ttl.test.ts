// Upload URL lifetime and WebP (#43): `/api/uploads` keeps the 5-minute default, a caller (capture)
// may ask for up to 10 minutes, and WebP is on the allow-list with magic-byte sniffing.
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  checkUploadTtl,
  createMemoryObjectStore,
  findAllowedType,
  isCompatible,
  MAX_UPLOAD_URL_TTL_SECONDS,
  objectKey,
  SIGNED_URL_TTL_SECONDS,
  sniffMime,
} from '../index.ts';

const WORKSPACE = randomUUID();
const NOW = new Date('2026-10-19T10:00:00Z');

const WEBP = new Uint8Array(
  Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x24, 0, 0, 0]),
    Buffer.from('WEBPVP8 '),
    Buffer.alloc(256),
  ]),
);

describe('upload URL lifetime', () => {
  it('defaults to 5 minutes and allows up to 10', () => {
    expect(checkUploadTtl(undefined)).toBe(SIGNED_URL_TTL_SECONDS);
    expect(MAX_UPLOAD_URL_TTL_SECONDS).toBe(600);
    expect(checkUploadTtl(600)).toBe(600);
    for (const bad of [0, -1, 601, 1.5]) {
      expect(() => checkUploadTtl(bad), String(bad)).toThrow(RangeError);
    }
  });

  it('signs a PUT for the requested lifetime and expires it after', async () => {
    let now = NOW;
    const store = createMemoryObjectStore({ now: () => now });
    const key = objectKey({ workspaceId: WORKSPACE, kind: 'document', id: randomUUID() }, NOW);
    const input = { key, contentType: 'application/pdf', contentLength: 4 };

    const short = await store.presignPut(input);
    expect(short.expiresAt.getTime() - NOW.getTime()).toBe(300_000);
    const long = await store.presignPut({ ...input, expiresInSeconds: 600 });
    expect(long.expiresAt.getTime() - NOW.getTime()).toBe(600_000);
    await expect(store.presignPut({ ...input, expiresInSeconds: 601 })).rejects.toThrow(RangeError);

    // Seven minutes on: the 5-minute URL is dead, the 10-minute one still works.
    now = new Date(NOW.getTime() + 7 * 60_000);
    await expect(
      store.upload(short.url, { body: new Uint8Array(4), contentType: 'application/pdf' }),
    ).rejects.toBeDefined();
    await expect(
      store.upload(long.url, { body: new Uint8Array(4), contentType: 'application/pdf' }),
    ).resolves.toBeUndefined();
  });
});

describe('WebP', () => {
  it('is allowed as an image and sniffs from its bytes', async () => {
    const entry = findAllowedType('image', 'photo.webp', 'image/webp');
    expect(entry?.name).toBe('webp');
    if (entry === null) return;
    expect(isCompatible(entry, await sniffMime(WEBP))).toBe(true);
  });

  it('is not accepted as a PDF or for the wrong extension', async () => {
    expect(findAllowedType('document', 'photo.webp', 'image/webp')).toBeNull();
    const pdf = findAllowedType('document', 'a.pdf', 'application/pdf');
    expect(pdf).not.toBeNull();
    if (pdf === null) return;
    expect(isCompatible(pdf, await sniffMime(WEBP))).toBe(false);
  });
});
