// Bounded memory (#301): a synthetic workspace whose files total 2 GB exports while the process
// grows by less than 256 MB of RSS. The files are generated on the fly by a stub object store
// (incompressible bytes, 1 MiB chunks) and the archive goes to a counting sink, so neither side
// holds data: whatever the export retains shows up as RSS growth. The 2 GB run takes minutes on
// the shared host, so it runs only with EXPORT_MEMORY_TEST=1 (the ship and nightly CI jobs); a
// 64 MB run with the same bound proportionally tightened runs every time, and checks that the
// buffered `put` is never used. Growth is measured against the worker's RSS just before the build,
// because the test runner itself already holds well over 100 MB.
import { randomFillSync, randomUUID } from 'node:crypto';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import { objectKey, type MemoryObjectStore, type ObjectStore } from '@causedeck/storage';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestExport, runExportBuild } from '../index.ts';

import {
  captureLog,
  cleanup,
  lifecycleDb,
  newStore,
  seedWorkspaces,
  testKeys,
} from './fixtures.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

const MB = 1024 * 1024;
// eslint-disable-next-line no-process-env -- opt-in switch for a long test, not app configuration.
const FULL = process.env.EXPORT_MEMORY_TEST === '1';

const keys = testKeys();
let db: Database;
let base: MemoryObjectStore;
let seeded: TwoTenants;

beforeAll(async () => {
  db = lifecycleDb();
  base = newStore();
  seeded = await seedWorkspaces(db, base);
});

afterAll(async () => {
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

/** Insert `count` finalized plaintext blobs of `size` bytes each; returns their keys. */
async function syntheticFiles(workspaceId: string, count: number, size: number) {
  const sizes = new Map<string, number>();
  await withWorkspace(db, { workspaceId }, async (tx) => {
    for (let i = 0; i < count; i++) {
      const id = randomUUID();
      const key = objectKey({ workspaceId, kind: 'document', id });
      sizes.set(key, size);
      await tx.insert(schema.blob).values({
        id,
        workspaceId,
        key,
        kind: 'document',
        filename: `synthetic-${String(i)}.pdf`,
        size,
        sha256: '0'.repeat(64),
        mime: 'application/pdf',
        scanStatus: 'clean',
        createdBy: null,
        finalizedAt: new Date(),
      });
    }
  });
  return sizes;
}

/** Files come from `sizes` (generated); the archive is counted and dropped. */
function syntheticStore(sizes: Map<string, number>) {
  const stats = { written: 0, buffered: 0 };
  const store: ObjectStore = {
    ...base,
    put: (input) => {
      stats.buffered += 1;
      return base.put(input);
    },
    async putStream(input) {
      for await (const chunk of input.body) stats.written += chunk.byteLength;
      return { size: stats.written };
    },
    getStream: (key) => {
      const size = sizes.get(key);
      if (size === undefined) return base.getStream(key);
      async function* body(): AsyncGenerator<Uint8Array> {
        for (let left = size ?? 0; left > 0; left -= MB) {
          await Promise.resolve();
          yield randomFillSync(Buffer.allocUnsafe(Math.min(MB, left)));
        }
      }
      return Promise.resolve({ body: body(), meta: { key, size } });
    },
  };
  return { store, stats };
}

async function exportWithin(total: number, files: number, boundBytes: number) {
  const workspaceId = seeded.a.id;
  const sizes = await syntheticFiles(workspaceId, files, Math.floor(total / files));
  const { store, stats } = syntheticStore(sizes);
  const job = await requestExport(
    { db, workspaceId, userId: seeded.ua },
    { scope: 'workspace' },
    { enqueue: () => Promise.resolve(null) },
  );
  gc();
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 25);
  try {
    const { log } = captureLog();
    expect(await runExportBuild({ db, log }, { workspaceId, jobId: job.id }, { store, keys })).toBe(
      'built',
    );
  } finally {
    clearInterval(timer);
  }
  peak = Math.max(peak, process.memoryUsage().rss);
  expect(stats.written).toBeGreaterThan(total);
  expect(stats.buffered).toBe(0);
  expect(
    peak - baseline,
    `RSS grew by ${String(Math.round((peak - baseline) / MB))} MB`,
  ).toBeLessThan(boundBytes);
  // Leave the workspace's blobs as they were for the next run.
  await withWorkspace(db, { workspaceId }, async (tx) => {
    await tx.delete(schema.blob).where(inArray(schema.blob.key, [...sizes.keys()]));
  });
}

describe('export memory', () => {
  it('streams a 64 MB workspace through the multipart path in bounded memory', async () => {
    await exportWithin(64 * MB, 8, 128 * MB);
  }, 300_000);

  it.runIf(FULL)(
    'exports a 2 GB synthetic workspace under 256 MB of RSS growth',
    async () => {
      await exportWithin(2048 * MB, 40, 256 * MB);
    },
    3_600_000,
  );
});
