// `system.export.expire` (#301): a ready export past its 24 h expiry becomes `expired`, its token
// hash is cleared, and the encrypted object and its `blob` row are deleted; an export not yet due
// is untouched; a second run changes nothing. Runs as causedeck_app in a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import { createMemoryObjectStore, objectKey } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';

import { runExportExpire } from './export-expire.ts';

const log = { info: () => undefined } as unknown as Logger;

async function readyExport(tx: Transaction, workspaceId: string, requestedBy: string, at: Date) {
  const store = createMemoryObjectStore();
  const blobId = randomUUID();
  const key = objectKey({ workspaceId, kind: 'export', id: blobId }, at);
  await store.put({
    key,
    body: Buffer.from('ciphertext'),
    contentType: 'application/octet-stream',
  });
  const jobId = randomUUID();
  await inWorkspace(tx, workspaceId, async (s) => {
    await s.insert(schema.blob).values({
      id: blobId,
      workspaceId,
      key,
      kind: 'export',
      filename: `causedeck-export-${jobId}.zip`,
      size: 10,
      sha256: 'c'.repeat(64),
      mime: 'application/zip',
      scanStatus: 'skipped',
      createdBy: null,
      finalizedAt: at,
    });
    await s.insert(schema.exportJob).values({
      id: jobId,
      workspaceId,
      requestedBy,
      scope: 'workspace',
      status: 'ready',
      progress: 100,
      blobId,
      sizeBytes: 10,
      sha256: 'c'.repeat(64),
      downloadTokenHash: 'd'.repeat(64),
      completedAt: at,
      expiresAt: new Date(at.getTime() + 24 * 60 * 60 * 1000),
    });
  });
  return { store, key, blobId, jobId };
}

describe('system.export.expire', () => {
  it('expires a ready export 24 h after it was ready and deletes its object and blob row', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const at = new Date();
      const { store, key, blobId, jobId } = await readyExport(tx, workspaceId, ownerId, at);
      const day = 24 * 60 * 60 * 1000;
      const exportRow = () =>
        inWorkspace(tx, workspaceId, async (s) => {
          const [row] = await s
            .select()
            .from(schema.exportJob)
            .where(eq(schema.exportJob.id, jobId));
          return row;
        });

      await runExportExpire(
        { db: tx, log },
        { store, now: () => new Date(at.getTime() + day - 1000) },
      );
      expect((await exportRow())?.status).toBe('ready');
      expect(await store.head(key)).not.toBeNull();

      await runExportExpire(
        { db: tx, log },
        { store, now: () => new Date(at.getTime() + day + 1000) },
      );
      expect(await exportRow()).toMatchObject({ status: 'expired', downloadTokenHash: null });
      expect(await store.head(key)).toBeNull();
      const blobs = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.blob).where(eq(schema.blob.id, blobId)),
      );
      expect(blobs).toEqual([]);

      // Idempotent: nothing left to do for this export.
      await runExportExpire(
        { db: tx, log },
        { store, now: () => new Date(at.getTime() + day + 2000) },
      );
      expect((await exportRow())?.status).toBe('expired');
    });
  });
});
