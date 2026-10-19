// Workspace export (#301): the ZIP has README.txt, JSON Lines for every registered table, CSV for
// the core human-readable tables, decrypted original files and manifest.json; the integrity test
// recomputes every listed sha256 and size; the job reports monotonic progress, is idempotent,
// and fails cleanly (expiry: jobs/definitions/export-expire.test.ts). Commits to the
// shared test database through its own pool (see fixtures.ts).
import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import {
  decryptForWorkspace,
  storeSystemBlob,
  type MemoryObjectStore,
  type ObjectKey,
} from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CSV_TABLES, registeredExporters } from '../export/registry.ts';
import { EXPORT_TTL_MS, runExportBuild } from '../export/run.ts';
import {
  MANIFEST_PATH,
  README_PATH,
  verifyManifest,
  type ExportManifest,
  getExportJob,
  requestExport,
} from '../index.ts';

import {
  captureLog,
  cleanup,
  lifecycleDb,
  newStore,
  readAll,
  seedWorkspaces,
  testKeys,
} from './fixtures.ts';
import { unzip } from './unzip.ts';

const keys = testKeys();
let db: Database;
let store: MemoryObjectStore;
let seeded: TwoTenants;
const PDF = Buffer.from('%PDF-1.4\n% a confidential pleading\n%%EOF\n');
let encryptedBlobId: string;

beforeAll(async () => {
  db = lifecycleDb();
  store = newStore();
  seeded = await seedWorkspaces(db, store);
  ({ blobId: encryptedBlobId } = await storeSystemBlob(
    { db, store, keys, workspaceId: seeded.a.id },
    { kind: 'document', filename: 'Vakalatnama: final?.pdf', mime: 'application/pdf', bytes: PDF },
  ));
});

afterAll(async () => {
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

const noEnqueue = { enqueue: () => Promise.resolve(null) };

async function build(workspaceId: string, userId: string, scope: 'workspace' | 'user') {
  const job = await requestExport({ db, workspaceId, userId }, { scope }, noEnqueue);
  const { log } = captureLog();
  const outcome = await runExportBuild(
    { db, log },
    { workspaceId, jobId: job.id },
    { store, keys },
  );
  return { job, outcome };
}

/** The decrypted ZIP of a ready export. */
async function archiveOf(workspaceId: string, jobId: string): Promise<Map<string, Buffer>> {
  const [row] = await withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .select({ key: schema.blob.key })
      .from(schema.exportJob)
      .innerJoin(schema.blob, eq(schema.blob.id, schema.exportJob.blobId))
      .where(eq(schema.exportJob.id, jobId)),
  );
  if (!row) throw new Error('export has no blob');
  const { body } = await store.getStream(row.key as ObjectKey);
  return unzip(await readAll(decryptForWorkspace(db, keys, workspaceId, body)));
}

const lines = (bytes: Buffer | undefined) =>
  (bytes ?? Buffer.alloc(0))
    .toString('utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('workspace export', () => {
  let entries: Map<string, Buffer>;
  let manifest: ExportManifest;
  let jobId: string;

  beforeAll(async () => {
    const { job, outcome } = await build(seeded.a.id, seeded.ua, 'workspace');
    expect(outcome).toBe('built');
    jobId = job.id;
    entries = await archiveOf(seeded.a.id, jobId);
    manifest = JSON.parse(entries.get(MANIFEST_PATH)?.toString('utf8') ?? 'null') as ExportManifest;
  });

  it('has README.txt, manifest.json and a JSON Lines file for every registered table', () => {
    expect(entries.get(README_PATH)?.toString('utf8')).toContain('manifest.json');
    const tables = registeredExporters().flatMap((e) => e.tables);
    expect(tables.length).toBeGreaterThan(20);
    for (const table of tables) {
      expect(entries.has(`data/${table}.jsonl`), table).toBe(true);
    }
    // Every seeded tenant table that is exported has its seeded row.
    for (const table of tables.filter((t) => t !== 'organization')) {
      expect(manifest.counts[table], table).toBeGreaterThan(0);
    }
    expect(manifest.counts.organization).toBe(1);
  });

  it('writes CSV with a header for the core human-readable tables', () => {
    for (const table of CSV_TABLES) {
      const csv = entries.get(`data/${table}.csv`)?.toString('utf8');
      expect(csv, table).toBeDefined();
      const rows = (csv ?? '').split('\r\n').filter((l) => l.length > 0);
      expect(rows.length, table).toBe((manifest.counts[table] ?? 0) + (rows.length > 0 ? 1 : 0));
    }
    expect(entries.get('data/member.csv')?.toString('utf8').split('\r\n')[0]).toBe(
      'id,user_id,name,email,role,status,joined_at,created_at',
    );
  });

  it('includes the original files, decrypted, under files/<kind>/<id>-<name>', () => {
    expect(entries.get(`files/document/${encryptedBlobId}-Vakalatnama_ final_.pdf`)).toEqual(PDF);
    const seededBlob = (seeded.a.rows.blob as { id: string }).id;
    expect(entries.get(`files/document/${seededBlob}-seed.pdf`)?.toString()).toBe(
      `seed file ${seededBlob}`,
    );
    expect(manifest.fileCount).toBe(2);
  });

  it('lists every entry in the manifest with a sha256 and size the integrity check recomputes', () => {
    expect(manifest.version).toBe(1);
    expect(manifest.workspaceId).toBe(seeded.a.id);
    expect(manifest.excluded).toHaveProperty('workspace_key');
    expect(verifyManifest(manifest, entries)).toEqual([]);
    const data = manifest.files.find((f) => f.path === 'data/member.jsonl');
    expect(data?.rows).toBe(lines(entries.get('data/member.jsonl')).length);

    const tampered = new Map(entries);
    tampered.set('data/member.jsonl', Buffer.from('{}\n'));
    tampered.set('extra.txt', Buffer.from('x'));
    expect(verifyManifest(manifest, tampered)).toEqual(
      expect.arrayContaining([
        { path: 'data/member.jsonl', problem: 'bytes' },
        { path: 'data/member.jsonl', problem: 'sha256' },
        { path: 'extra.txt', problem: 'unlisted' },
      ]),
    );
  });

  it('drops secrets: invitation token hashes, raw webhook payloads, envelope headers', () => {
    expect(lines(entries.get('data/invitation.jsonl'))[0]).not.toHaveProperty('token_hash');
    expect(lines(entries.get('data/billing_event.jsonl'))[0]).not.toHaveProperty('payload');
    const blobRow = lines(entries.get('data/blob.jsonl'))[0];
    expect(blobRow).not.toHaveProperty('enc_header');
    expect(entries.has('data/workspace_key.jsonl')).toBe(false);
    expect(entries.has('data/job_effect.jsonl')).toBe(false);
  });

  it('marks the job ready with size, sha256, progress 100 and a 24 h expiry', async () => {
    const job = await getExportJob({ db, workspaceId: seeded.a.id, userId: seeded.ua }, jobId);
    expect(job).toMatchObject({ status: 'ready', progress: 100, phase: 'ready' });
    expect(job?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(job?.sizeBytes).toBeGreaterThan(0);
    expect((job?.expiresAt?.getTime() ?? 0) - (job?.completedAt?.getTime() ?? 0)).toBe(
      EXPORT_TTL_MS,
    );
  });

  it('is idempotent: building a ready export again does nothing', async () => {
    const { log } = captureLog();
    expect(
      await runExportBuild({ db, log }, { workspaceId: seeded.a.id, jobId }, { store, keys }),
    ).toBe('skipped');
  });
});

describe('export job lifecycle', () => {
  it('reports progress that only grows while it builds', async () => {
    const job = await requestExport(
      { db, workspaceId: seeded.b.id, userId: seeded.ub },
      { scope: 'workspace' },
      noEnqueue,
    );
    const seen: number[] = [];
    const state = { polling: true };
    const poll = (async () => {
      while (state.polling) {
        const row = await getExportJob({ db, workspaceId: seeded.b.id, userId: seeded.ub }, job.id);
        if (row) seen.push(row.progress);
        await new Promise((r) => setTimeout(r, 20));
      }
    })();
    const { log } = captureLog();
    await runExportBuild({ db, log }, { workspaceId: seeded.b.id, jobId: job.id }, { store, keys });
    state.polling = false;
    await poll;
    const final = await getExportJob({ db, workspaceId: seeded.b.id, userId: seeded.ub }, job.id);
    seen.push(final?.progress ?? -1);
    expect(seen.at(-1)).toBe(100);
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
  });

  it('marks the export failed on the last attempt and leaves no object behind', async () => {
    const ws = seeded.a.id;
    // A second requester: an owner other than ua (one export in flight per requester).
    await withWorkspace(db, { workspaceId: ws }, (tx) =>
      tx.update(schema.member).set({ role: 'owner' }).where(eq(schema.member.userId, seeded.uboth)),
    );
    const job = await requestExport(
      { db, workspaceId: ws, userId: seeded.uboth },
      { scope: 'workspace' },
      noEnqueue,
    );
    const broken = {
      ...store,
      getStream: () => Promise.reject(Object.assign(new Error('boom'), { code: 'STORE_DOWN' })),
    };
    const before = (await store.list(ws, { kind: 'export' })).length;
    const { log } = captureLog();
    await expect(
      runExportBuild(
        { db, log, finalAttempt: true },
        { workspaceId: ws, jobId: job.id },
        { store: broken, keys },
      ),
    ).rejects.toThrow('boom');
    const row = await getExportJob({ db, workspaceId: ws, userId: seeded.uboth }, job.id);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'STORE_DOWN' });
    expect((await store.list(ws, { kind: 'export' })).length).toBe(before);
    await withWorkspace(db, { workspaceId: ws }, (tx) =>
      tx
        .update(schema.member)
        .set({ role: 'advocate' })
        .where(eq(schema.member.userId, seeded.uboth)),
    );
  });
});
