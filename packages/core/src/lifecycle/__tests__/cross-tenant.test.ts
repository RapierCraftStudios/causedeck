// Cross-tenant proof for the export services (#301; registered in SERVICE_TESTS). Workspace B's
// owner cannot request, see, get a link for or download workspace A's export; A's members who are
// not owners cannot request one; A's archive holds no row of B; a user who belongs to both
// workspaces exports only the current one; and `runExportBuild` stays in its payload workspace.
import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import { decryptForWorkspace, type MemoryObjectStore, type ObjectKey } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getExportJob,
  issueExportDownload,
  listExportJobs,
  openExportDownload,
  requestExport,
  runExportBuild,
  type ExportJob,
} from '../index.ts';

import {
  captureLog,
  cleanup,
  lifecycleDb,
  newStore,
  readAll,
  SECRET,
  seedWorkspaces,
  testKeys,
} from './fixtures.ts';
import { unzip } from './unzip.ts';

const keys = testKeys();
const noEnqueue = { enqueue: () => Promise.resolve(null) };
let db: Database;
let store: MemoryObjectStore;
let seeded: TwoTenants;
let jobA: ExportJob;
let tokenA: string;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

async function buildAndRead(workspaceId: string, userId: string, scope: 'workspace' | 'user') {
  const job = await requestExport({ db, workspaceId, userId }, { scope }, noEnqueue);
  const { log } = captureLog();
  await runExportBuild({ db, log }, { workspaceId, jobId: job.id }, { store, keys });
  const link = await issueExportDownload({ db, workspaceId, userId }, job.id, { secret: SECRET });
  const download = await openExportDownload({ db, workspaceId, userId }, job.id, link.token, {
    store,
    keys,
    secret: SECRET,
  });
  return { job, link, entries: unzip(await readAll(download.body)) };
}

const allText = (entries: Map<string, Buffer>) =>
  [...entries.values()].map((b) => b.toString('utf8')).join('\n');

beforeAll(async () => {
  db = lifecycleDb();
  store = newStore();
  seeded = await seedWorkspaces(db, store);
  const built = await buildAndRead(seeded.a.id, seeded.ua, 'workspace');
  jobA = built.job;
  tokenA = built.link.token;
});

afterAll(async () => {
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

describe('export services across workspaces', () => {
  it("B's owner cannot request an export of A", async () => {
    expect(
      await codeOf(
        requestExport(
          { db, workspaceId: seeded.a.id, userId: seeded.ub },
          { scope: 'workspace' },
          noEnqueue,
        ),
      ),
    ).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
  });

  it("A's non-owner members cannot request an export", async () => {
    expect(
      await codeOf(
        requestExport(
          { db, workspaceId: seeded.a.id, userId: seeded.uboth },
          { scope: 'workspace' },
          noEnqueue,
        ),
      ),
    ).toBe('FORBIDDEN');
  });

  it("B's owner cannot see A's export, in A's scope or in B's", async () => {
    expect(await getExportJob({ db, workspaceId: seeded.a.id, userId: seeded.ub }, jobA.id)).toBe(
      null,
    );
    expect(await getExportJob({ db, workspaceId: seeded.b.id, userId: seeded.ub }, jobA.id)).toBe(
      null,
    );
    expect(await listExportJobs({ db, workspaceId: seeded.a.id, userId: seeded.ub })).toEqual([]);
    const own = await listExportJobs({ db, workspaceId: seeded.b.id, userId: seeded.ub });
    expect(own.map((j) => j.id)).not.toContain(jobA.id);
  });

  it("B's owner cannot get a link for or download A's export, even with A's token", async () => {
    expect(
      await codeOf(
        issueExportDownload({ db, workspaceId: seeded.a.id, userId: seeded.ub }, jobA.id, {
          secret: SECRET,
        }),
      ),
    ).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
    expect(
      await codeOf(
        issueExportDownload({ db, workspaceId: seeded.b.id, userId: seeded.ub }, jobA.id, {
          secret: SECRET,
        }),
      ),
    ).toBe('NOT_FOUND');
    for (const workspaceId of [seeded.a.id, seeded.b.id]) {
      expect(
        await codeOf(
          openExportDownload({ db, workspaceId, userId: seeded.ub }, jobA.id, tokenA, {
            store,
            keys,
            secret: SECRET,
          }),
        ),
      ).toMatch(/^(FORBIDDEN|NOT_FOUND)$/);
    }
  });

  it("A's archive holds A's rows and none of B's", async () => {
    const [row] = await withWorkspace(db, { workspaceId: seeded.a.id }, (tx) =>
      tx
        .select({ key: schema.blob.key })
        .from(schema.exportJob)
        .innerJoin(schema.blob, eq(schema.blob.id, schema.exportJob.blobId))
        .where(eq(schema.exportJob.id, jobA.id)),
    );
    if (!row) throw new Error('export has no blob');
    const { body } = await store.getStream(row.key as ObjectKey);
    const text = allText(unzip(await readAll(decryptForWorkspace(db, keys, seeded.a.id, body))));
    expect(text).toContain(seeded.a.id);
    expect(text).not.toContain(seeded.b.id);
    for (const value of Object.values(seeded.b.rows).flatMap((r) => Object.values(r))) {
      if (typeof value === 'string' && value.length >= 16) expect(text).not.toContain(value);
    }
  });

  it('a user in both workspaces exports only the current workspace', async () => {
    // uboth is an advocate in A and B; make them an owner of B for this export.
    await withWorkspace(db, { workspaceId: seeded.b.id }, (tx) =>
      tx.update(schema.member).set({ role: 'owner' }).where(eq(schema.member.userId, seeded.uboth)),
    );
    const { entries } = await buildAndRead(seeded.b.id, seeded.uboth, 'user');
    const text = allText(entries);
    expect(text).toContain(seeded.b.id);
    expect(text).not.toContain(seeded.a.id);
    const members = (entries.get('data/member.jsonl') ?? Buffer.alloc(0))
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { user_id: string });
    expect(members.map((m) => m.user_id)).toEqual([seeded.uboth]);
  });

  it('runExportBuild stays in its payload workspace', async () => {
    const { log } = captureLog();
    expect(
      await runExportBuild(
        { db, log },
        { workspaceId: seeded.b.id, jobId: jobA.id },
        { store, keys },
      ),
    ).toBe('missing');
  });
});
