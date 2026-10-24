// Cross-tenant capture (#43): user `ub`, working in workspace B, uses workspace A's capture id, A's
// matter and A's raw object. Every call must be NOT_FOUND (RLS hides A's rows) or change nothing;
// A's capture, channels and objects are untouched afterwards, and A's own owner can still use the
// capture, so the probes are sound.
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { createMemoryObjectStore, objectKey } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  completeUpload,
  createCapture,
  discardCapture,
  enableChannel,
  CAPTURE_DISCLOSURE_VERSION,
  pinCapture,
  sweepExpiredCaptures,
} from '../index.ts';

import { harness, newMatter, NOW, PDF, readCapture, sha256 } from './fixtures.ts';

const notFound = { code: 'NOT_FOUND' };

describe('cross-tenant capture: ub on workspace B against A (#43)', () => {
  it('cannot complete, discard or pin A’s capture, and A’s capture is unchanged', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ua, ub } = await seedTwoTenants(tx);
      const aCaptureId = a.rows['capture']?.id ?? '';
      const hb = harness(tx, b.id, ub);
      const before = await readCapture(tx, a.id, aCaptureId);

      await expect(completeUpload(hb.ctx, aCaptureId, sha256(PDF))).rejects.toMatchObject(notFound);
      await expect(discardCapture(hb.ctx, aCaptureId)).rejects.toMatchObject(notFound);
      await expect(pinCapture(hb.ctx, aCaptureId, true)).rejects.toMatchObject(notFound);

      expect(await readCapture(tx, a.id, aCaptureId)).toEqual(before);
      // A's owner reaches the capture (the probe is sound).
      const ha = harness(tx, a.id, ua);
      expect((await pinCapture(ha.ctx, aCaptureId, true)).pinned).toBe(true);
    });
  });

  it('cannot hint at A’s matter or see A’s captures through B’s scope', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ub } = await seedTwoTenants(tx);
      const aMatter = await newMatter(tx, a.id, false);
      const hb = harness(tx, b.id, ub);
      await expect(
        createCapture(hb.ctx, {
          channel: 'upload',
          filename: 'order.pdf',
          mime: 'application/pdf',
          sizeBytes: PDF.byteLength,
          sha256: sha256(PDF),
          matterHintId: aMatter,
        }),
      ).rejects.toMatchObject(notFound);
      const seen = await inWorkspace(tx, b.id, (s) => s.select().from(schema.capture));
      expect(seen.every((row) => row.workspaceId === b.id)).toBe(true);
    });
  });

  it('enabling a channel in B leaves A’s channels alone', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ub } = await seedTwoTenants(tx);
      const hb = harness(tx, b.id, ub);
      await enableChannel(hb.ctx, {
        channel: 'whatsapp_export',
        disclosureVersion: CAPTURE_DISCLOSURE_VERSION,
      });
      const rowsOfA = await inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.workspaceCaptureChannel),
      );
      expect(rowsOfA.map((row) => row.channel)).toEqual(['email']);
    });
  });

  it('the retention sweep in B never deletes A’s raw objects', async () => {
    await withTestDb(async (tx) => {
      const { a, b, ub } = await seedTwoTenants(tx);
      const store = createMemoryObjectStore();
      const key = objectKey({ workspaceId: a.id, kind: 'document', id: crypto.randomUUID() }, NOW);
      await store.put({ key, body: PDF, contentType: 'application/pdf' });
      const aCaptureId = a.rows['capture']?.id ?? '';
      await inWorkspace(tx, a.id, (s) =>
        s
          .update(schema.capture)
          .set({ rawStorageKey: key, ttlAt: new Date(NOW.getTime() - 1000) })
          .where(eq(schema.capture.id, aCaptureId)),
      );
      const hb = harness(tx, b.id, ub, { store });
      expect(
        await sweepExpiredCaptures({ db: tx, store, now: () => NOW }, hb.ctx.workspaceId),
      ).toEqual({ deleted: 0 });
      expect(await store.head(key)).not.toBeNull();
      expect((await readCapture(tx, a.id, aCaptureId)).rawStorageKey).toBe(key);
    });
  });
});
