// The sealed and stored content of the demo workspaces (#985): memory M1 to M7 sealed under the
// workspace key (decrypted back to the seed's plain values, never stored in the clear), the sample
// PDFs put in the bucket with a finalized blob row each, and both idempotent.
import { randomBytes } from 'node:crypto';

import { Secret } from '@causedeck/config/env';
import { schema } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  DEMO_WORKSPACES,
  demoDocumentPdfs,
  demoMemory,
  seedDemo,
  seedInstant,
} from '@causedeck/db/seed/demo';
import {
  createMemoryObjectStore,
  decryptField,
  EnvKeyProvider,
  getWorkspaceDek,
  type ObjectKey,
} from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { seedDemoFiles, seedDemoMemory } from '../content.ts';

const TODAY = '2026-10-21';
const keys = new EnvKeyProvider([{ id: 'kek-1', key: new Secret(randomBytes(32)) }]);
const ws = DEMO_WORKSPACES['bengaluru-chamber'];

describe('demo content: sealed memory', () => {
  it('writes M1 to M5 sealed under the workspace key, once', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY, workspaces: ['bengaluru-chamber'] });
      const first = await seedDemoMemory({ db: tx, keys }, 'bengaluru-chamber', { today: TODAY });
      const again = await seedDemoMemory({ db: tx, keys }, 'bengaluru-chamber', { today: TODAY });
      expect(again).toEqual(first);
      const expected = demoMemory(ws, TODAY);
      const items = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.memoryItem).where(eq(schema.memoryItem.workspaceId, ws.id)),
      );
      expect(items).toHaveLength(expected.items.length);
      expect(new Set(items.map((i) => i.layer))).toEqual(
        new Set(expected.items.map((i) => i.layer)),
      );
      for (const layer of ['M1', 'M2', 'M3', 'M4', 'M5']) {
        expect(
          items.some((i) => i.layer === layer),
          layer,
        ).toBe(true);
      }
      const dek = await getWorkspaceDek(tx, keys, ws.id);
      for (const item of items) {
        expect(item.valueCiphertext).not.toBeNull();
        const plain: unknown = JSON.parse(decryptField(dek, ws.id, item.valueCiphertext ?? ''));
        expect(plain).toEqual(expected.items.find((e) => e.id === item.id)?.value);
      }
      const proposals = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.memoryProposal).where(eq(schema.memoryProposal.workspaceId, ws.id)),
      );
      expect(new Set(proposals.map((p) => p.status))).toEqual(
        new Set(['proposed', 'dismissed', 'observing']),
      );
    });
  });
});

describe('demo content: sample PDFs in the bucket', () => {
  it('stores every order PDF at its document key with a finalized blob, once', async () => {
    await withTestDb(async (tx) => {
      await seedDemo(tx, { today: TODAY, workspaces: ['bengaluru-chamber'] });
      const store = createMemoryObjectStore();
      const first = await seedDemoFiles({ db: tx, store }, 'bengaluru-chamber', { today: TODAY });
      expect(
        (await seedDemoFiles({ db: tx, store }, 'bengaluru-chamber', { today: TODAY })).files,
      ).toBe(first.files);
      const pdfs = demoDocumentPdfs(ws, TODAY, seedInstant(TODAY));
      expect(first.files).toBe(pdfs.length);
      const docs = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.document).where(eq(schema.document.workspaceId, ws.id)),
      );
      for (const doc of docs.filter((d) => d.kind === 'order')) {
        const stored = await store.get(doc.storageKey as ObjectKey);
        expect(Buffer.from(stored.body).toString('latin1')).toContain('SYNTHETIC');
      }
      const blobs = await inWorkspace(tx, ws.id, (s) =>
        s.select().from(schema.blob).where(eq(schema.blob.workspaceId, ws.id)),
      );
      expect(blobs).toHaveLength(pdfs.length);
      expect(blobs.every((b) => b.finalizedAt !== null && b.scanStatus === 'skipped')).toBe(true);
      expect(blobs.every((b) => b.mime === 'application/pdf')).toBe(true);
    });
  });
});
