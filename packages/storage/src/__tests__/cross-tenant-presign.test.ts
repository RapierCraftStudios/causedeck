// Cross-tenant storage presign (#19, #209, #217): user B, a member of workspace B, asking for a
// download URL, finalizing, or uploading against workspace A's blobs gets NOT_FOUND and never a
// URL. The services take blob ids, never object keys, and build every key from the caller's own
// workspace, so B cannot guess a way into A's `ws/<A>/` prefix; a signed URL is bound to its key.
// Runs as causedeck_app in a rolled-back transaction, under FORCE row-level security.
import { blob } from '@causedeck/db/schema';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createDownloadUrl,
  createMemoryObjectStore,
  createUploadIntent,
  finalizeUpload,
  workspacePrefix,
} from '../index.ts';

import { ctxFor, errorOf, SAMPLES } from './upload-fixtures.ts';

const PDF = { kind: 'document', filename: 'a.pdf', mime: 'application/pdf' } as const;

describe('cross-tenant storage presign', () => {
  it('user B gets NOT_FOUND for download, finalize and re-finalize of workspace A blobs', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      const store = createMemoryObjectStore();
      const ctxA = ctxFor({ db: tx, store, workspaceId: a.id, userId: ua });
      const ctxB = ctxFor({ db: tx, store, workspaceId: b.id, userId: ub });

      // A: one finalized upload and one open intent, plus the seeded finalized row.
      const done = await createUploadIntent(ctxA, { ...PDF, size: SAMPLES.pdf.byteLength });
      await store.upload(done.upload.url, { body: SAMPLES.pdf, contentType: 'application/pdf' });
      await finalizeUpload(ctxA, done.blobId);
      const open = await createUploadIntent(ctxA, { ...PDF, size: SAMPLES.pdf.byteLength });
      await store.upload(open.upload.url, { body: SAMPLES.pdf, contentType: 'application/pdf' });
      const seeded = a.rows.blob?.id ?? '';

      for (const id of [done.blobId, open.blobId, seeded]) {
        expect(await errorOf(createDownloadUrl(ctxB, id)), id).toMatchObject({ code: 'NOT_FOUND' });
        expect(await errorOf(finalizeUpload(ctxB, id)), id).toMatchObject({ code: 'NOT_FOUND' });
      }

      // B's failed attempts changed nothing of A's: the open intent is still open and A can finish it.
      const openRow = await inWorkspace(tx, a.id, (scoped) =>
        scoped.select().from(blob).where(eq(blob.id, open.blobId)),
      );
      expect(openRow[0]?.scanStatus).toBeNull();
      expect((await finalizeUpload(ctxA, open.blobId)).scanStatus).toBe('pending');
      expect((await createDownloadUrl(ctxA, done.blobId)).url).toMatch(/^memory:/);
    });
  });

  it("user B's intents are always keyed under B's own prefix", async () => {
    await withTestDb(async (tx) => {
      const { a, b, ub } = await seedTwoTenants(tx);
      const store = createMemoryObjectStore();
      const ctxB = ctxFor({ db: tx, store, workspaceId: b.id, userId: ub });
      const intent = await createUploadIntent(ctxB, { ...PDF, size: 10 });
      expect(intent.key.startsWith(workspacePrefix(b.id))).toBe(true);
      expect(intent.key.startsWith(workspacePrefix(a.id))).toBe(false);
      expect(intent.upload.url).not.toContain(a.id);
    });
  });

  it("a URL signed for B's object cannot be redirected to A's key", async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      const store = createMemoryObjectStore();
      const ctxA = ctxFor({ db: tx, store, workspaceId: a.id, userId: ua });
      const ctxB = ctxFor({ db: tx, store, workspaceId: b.id, userId: ub });
      const secret = new Uint8Array(Buffer.from('%PDF-1.7\n% A privileged\n%%EOF\n'));
      const aIntent = await createUploadIntent(ctxA, { ...PDF, size: secret.byteLength });
      await store.upload(aIntent.upload.url, { body: secret, contentType: 'application/pdf' });
      await finalizeUpload(ctxA, aIntent.blobId);
      const bIntent = await createUploadIntent(ctxB, { ...PDF, size: SAMPLES.pdf.byteLength });
      await store.upload(bIntent.upload.url, { body: SAMPLES.pdf, contentType: 'application/pdf' });
      await finalizeUpload(ctxB, bIntent.blobId);

      const bUrl = (await createDownloadUrl(ctxB, bIntent.blobId)).url;
      const forged = bUrl.replace(bIntent.key, aIntent.key);
      expect(forged).not.toBe(bUrl);
      const { body } = await store.fetchSigned(forged);
      expect(Buffer.from(body)).toEqual(Buffer.from(SAMPLES.pdf));
      expect(Buffer.from(body)).not.toEqual(Buffer.from(secret));
    });
  });

  it('a user in both workspaces reaches each blob only through its own workspace', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, uboth } = await seedTwoTenants(tx);
      const store = createMemoryObjectStore();
      const ctxA = ctxFor({ db: tx, store, workspaceId: a.id, userId: ua });
      const intent = await createUploadIntent(ctxA, { ...PDF, size: SAMPLES.pdf.byteLength });
      await store.upload(intent.upload.url, { body: SAMPLES.pdf, contentType: 'application/pdf' });
      await finalizeUpload(ctxA, intent.blobId);

      const bothInA = ctxFor({ db: tx, store, workspaceId: a.id, userId: uboth });
      const bothInB = ctxFor({ db: tx, store, workspaceId: b.id, userId: uboth });
      expect((await createDownloadUrl(bothInA, intent.blobId)).url).toMatch(/^memory:/);
      expect(await errorOf(createDownloadUrl(bothInB, intent.blobId))).toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
