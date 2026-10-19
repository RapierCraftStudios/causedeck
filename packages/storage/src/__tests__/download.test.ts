// Download URLs (#217): 60-second presigned GETs that force `Content-Disposition: attachment`, the
// sniffed type and `nosniff`, issued only for a finalized, clean-or-pending blob of the caller's
// workspace after `document.read`, and audited. DB-backed parts run as causedeck_app, rolled back.
import { Secret } from '@causedeck/config/env';
import { blob } from '@causedeck/db/schema';
import type { Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  attachmentDisposition,
  createDownloadUrl,
  createMemoryObjectStore,
  createS3ObjectStore,
  createUploadIntent,
  DOWNLOAD_URL_TTL_SECONDS,
  finalizeUpload,
  objectKey,
  setStorageAuditSink,
  type StorageAuditEvent,
} from '../index.ts';

import { ctxFor, errorOf, SAMPLES, TestForbiddenError } from './upload-fixtures.ts';

const NOW = new Date('2026-10-19T10:00:00Z');

afterEach(() => {
  setStorageAuditSink(null);
});

async function uploaded(tx: Transaction, allow?: ('document.read' | 'document.write')[]) {
  const { a, ua } = await seedTwoTenants(tx);
  let clock = NOW;
  const store = createMemoryObjectStore({ now: () => clock });
  const writer = ctxFor({ db: tx, store, workspaceId: a.id, userId: ua, now: () => clock });
  const intent = await createUploadIntent(writer, {
    kind: 'document',
    filename: 'Order "final" — 12.10.pdf',
    size: SAMPLES.pdf.byteLength,
    mime: 'application/pdf',
  });
  await store.upload(intent.upload.url, { body: SAMPLES.pdf, contentType: 'application/pdf' });
  await finalizeUpload(writer, intent.blobId);
  const reader = ctxFor({
    db: tx,
    store,
    workspaceId: a.id,
    userId: ua,
    now: () => clock,
    ...(allow ? { allow } : {}),
  });
  return {
    a,
    ua,
    store,
    intent,
    reader,
    tick: (ms: number) => (clock = new Date(clock.getTime() + ms)),
  };
}

describe('createDownloadUrl', () => {
  it('issues a 60 s attachment URL with the sniffed type and nosniff, after document.read', async () => {
    await withTestDb(async (tx) => {
      const events: StorageAuditEvent[] = [];
      setStorageAuditSink({ write: (_tx, event) => Promise.resolve(void events.push(event)) });
      const { a, ua, store, intent, reader, tick } = await uploaded(tx);

      const download = await createDownloadUrl(reader, intent.blobId);
      expect(reader.checked).toEqual(['document.read']);
      expect(DOWNLOAD_URL_TTL_SECONDS).toBe(60);
      expect(download.expiresAt.getTime() - NOW.getTime()).toBe(60_000);
      expect(download.headers).toEqual({ 'x-content-type-options': 'nosniff' });

      const response = await store.fetchSigned(download.url);
      expect(Buffer.from(response.body)).toEqual(Buffer.from(SAMPLES.pdf));
      expect(response.headers['content-disposition']).toMatch(/^attachment; /);
      expect(response.headers['content-disposition']).toContain(
        "filename*=UTF-8''Order%20%22final%22%20%E2%80%94%2012.10.pdf",
      );
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['x-content-type-options']).toBe('nosniff');

      expect(events).toEqual([
        {
          action: 'document.upload_finalized',
          workspaceId: a.id,
          actorUserId: ua,
          blobId: intent.blobId,
          at: NOW,
        },
        {
          action: 'document.download_url_issued',
          workspaceId: a.id,
          actorUserId: ua,
          blobId: intent.blobId,
          at: NOW,
        },
      ]);

      // Expired after 60 seconds.
      tick(61_000);
      expect(await errorOf(store.fetchSigned(download.url))).toMatchObject({ status: 403 });
    });
  });

  it('refuses without document.read and issues nothing', async () => {
    await withTestDb(async (tx) => {
      const events: StorageAuditEvent[] = [];
      setStorageAuditSink({ write: (_tx, event) => Promise.resolve(void events.push(event)) });
      const { intent, reader } = await uploaded(tx, []);
      expect(await errorOf(createDownloadUrl(reader, intent.blobId))).toBeInstanceOf(
        TestForbiddenError,
      );
      expect(events.map((e) => e.action)).toEqual(['document.upload_finalized']);
    });
  });

  it('returns NOT_FOUND for an open intent, an infected blob and an unknown id', async () => {
    await withTestDb(async (tx) => {
      const { a, intent, reader } = await uploaded(tx);
      const open = await createUploadIntent(reader, {
        kind: 'image',
        filename: 'scan.png',
        size: 10,
        mime: 'image/png',
      });
      expect(await errorOf(createDownloadUrl(reader, open.blobId))).toMatchObject({
        code: 'NOT_FOUND',
      });
      await inWorkspace(tx, a.id, (scoped) =>
        scoped.update(blob).set({ scanStatus: 'infected' }).where(eq(blob.id, intent.blobId)),
      );
      expect(await errorOf(createDownloadUrl(reader, intent.blobId))).toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await errorOf(createDownloadUrl(reader, crypto.randomUUID()))).toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await errorOf(createDownloadUrl(reader, 'x'))).toMatchObject({ code: 'NOT_FOUND' });
      expect(reader.checked).not.toContain('document.read');
    });
  });
});

describe('presignGet download options', () => {
  const key = objectKey({
    workspaceId: crypto.randomUUID(),
    kind: 'document',
    id: crypto.randomUUID(),
  });

  it('S3: signs a 60 s URL with response-content-disposition and response-content-type', async () => {
    const store = createS3ObjectStore({
      region: 'ap-south-1',
      bucket: 'causedeck-test',
      accessKey: new Secret('AKIAUNITACCESSKEY01'),
      secretKey: new Secret('unit-secret-key-value-01'),
      now: () => NOW,
    });
    const disposition = attachmentDisposition('brief.pdf');
    const signed = await store.presignGet(key, {
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      contentDisposition: disposition,
      contentType: 'application/pdf',
    });
    const url = new URL(signed.url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('response-content-disposition')).toBe(disposition);
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(signed.expiresAt.getTime() - NOW.getTime()).toBe(60_000);
  });

  it('S3: keeps the 5-minute default with no overrides when called without options', async () => {
    const store = createS3ObjectStore({
      region: 'ap-south-1',
      bucket: 'causedeck-test',
      accessKey: new Secret('AKIAUNITACCESSKEY01'),
      secretKey: new Secret('unit-secret-key-value-01'),
      now: () => NOW,
    });
    const url = new URL((await store.presignGet(key)).url);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
  });

  it('rejects a lifetime outside 1 to 300 seconds and a header with control characters', async () => {
    const store = createMemoryObjectStore();
    for (const expiresInSeconds of [0, 301, 1.5]) {
      await expect(store.presignGet(key, { expiresInSeconds })).rejects.toThrow(RangeError);
    }
    await expect(
      store.presignGet(key, { contentDisposition: 'attachment\r\nx: y' }),
    ).rejects.toThrow(RangeError);
  });

  it('builds an ASCII-only attachment header with a UTF-8 file name', () => {
    expect(attachmentDisposition('अनुबंध.pdf')).toMatch(
      /^attachment; filename="[\w.\- ]+"; filename\*=UTF-8''%E0%A4%85.*\.pdf$/,
    );
    expect(attachmentDisposition('a"b\\c.pdf')).toBe(
      `attachment; filename="a_b_c.pdf"; filename*=UTF-8''a%22b%5Cc.pdf`,
    );
  });
});
