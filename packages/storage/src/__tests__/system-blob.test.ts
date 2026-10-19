// `storeSystemBlob` (#255): a platform-written object is stored as envelope ciphertext under the
// workspace DEK and recorded as a finalized blob with no uploading user. Runs as causedeck_app in a
// rolled-back transaction, under FORCE row-level security.
import { blob } from '@causedeck/db/schema';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createMemoryObjectStore,
  decryptForWorkspace,
  EnvKeyProvider,
  parseHeader,
  storeSystemBlob,
} from '../index.ts';

import { collect, newKek, newWorkspace } from './workspace-fixtures.ts';

const keys = new EnvKeyProvider([newKek('kek-1')]);
const PDF = Buffer.from('%PDF-1.4\n% an invoice\n%%EOF\n');

describe('storeSystemBlob', () => {
  it('stores ciphertext and a finalized blob row the workspace can decrypt', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const store = createMemoryObjectStore();
      const at = new Date('2026-04-02T06:00:00Z');

      const { blobId, key } = await storeSystemBlob(
        { db: tx, store, keys, workspaceId: ws, now: () => at },
        { kind: 'document', filename: 'CD-26-27-000001.pdf', mime: 'application/pdf', bytes: PDF },
      );

      expect(key).toBe(`ws/${ws}/document/2026/${blobId}`);
      const stored = Buffer.from((await store.get(key)).body);
      expect(stored.subarray(0, 4).toString('ascii')).toBe('CDE1');
      expect(stored.includes(Buffer.from('%PDF'))).toBe(false);
      expect(await collect(decryptForWorkspace(tx, keys, ws, [stored]))).toEqual(PDF);

      const [row] = await inWorkspace(tx, ws, (s) =>
        s.select().from(blob).where(eq(blob.id, blobId)),
      );
      expect(row).toMatchObject({
        workspaceId: ws,
        key,
        kind: 'document',
        filename: 'CD-26-27-000001.pdf',
        mime: 'application/pdf',
        size: PDF.byteLength,
        scanStatus: 'skipped',
        createdBy: null,
        finalizedAt: at,
      });
      expect(row?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.encHeader && parseHeader(row.encHeader)?.workspaceId).toBe(ws);
    });
  });

  it('rejects a path-like file name and an empty object before writing anything', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const store = createMemoryObjectStore();
      const ctx = { db: tx, store, keys, workspaceId: ws };
      await expect(
        storeSystemBlob(ctx, {
          kind: 'document',
          filename: 'CD/26-27/000001.pdf',
          mime: 'application/pdf',
          bytes: PDF,
        }),
      ).rejects.toThrow(/invalid file name/);
      await expect(
        storeSystemBlob(ctx, {
          kind: 'document',
          filename: 'a.pdf',
          mime: 'application/pdf',
          bytes: new Uint8Array(),
        }),
      ).rejects.toThrow(/empty/);
      expect(await store.list(ws)).toEqual([]);
      const rows = await inWorkspace(tx, ws, (s) => s.select().from(blob));
      expect(rows).toEqual([]);
    });
  });
});
