// Workspace deletion cool-off (#302), on a fake clock: nothing is scheduled or erased before the 14
// days are up; the tick then schedules and enqueues the erase once, and re-enqueues a deletion a
// crash left scheduled; a second tick does not schedule it again.
import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import type { MemoryObjectStore } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  requestWorkspaceDeletion,
  runDeletionTick,
  runWorkspaceErase,
  type DeletionJob,
} from '../index.ts';

import {
  countRows,
  DAY,
  eraseDeps,
  noDelivery,
  spyEmail,
  superuserDb,
} from './deletion-fixtures.ts';
import { captureLog, cleanup, lifecycleDb, newStore, seedWorkspaces } from './fixtures.ts';

const T0 = new Date('2026-12-01T00:00:00.000Z');

let db: Database;
let su: Database;
let seeded: TwoTenants;
let store: MemoryObjectStore;
let job: DeletionJob;

function tick(now: Date) {
  const enqueued: { workspaceId: string; jobId: string }[] = [];
  const { log } = captureLog();
  return runDeletionTick(
    { db, log },
    {
      now: () => now,
      enqueue: (j) => {
        enqueued.push(j);
        return Promise.resolve(null);
      },
    },
  ).then((report) => ({ report, mine: enqueued.filter((j) => j.jobId === job.id) }));
}

async function status(): Promise<string | undefined> {
  const [row] = await withWorkspace(db, { workspaceId: seeded.a.id }, (tx) =>
    tx.select().from(schema.deletionJob).where(eq(schema.deletionJob.id, job.id)),
  );
  return row?.status;
}

beforeAll(async () => {
  db = lifecycleDb();
  su = superuserDb();
  store = newStore();
  seeded = await seedWorkspaces(db, store);
  job = await requestWorkspaceDeletion(
    { db, workspaceId: seeded.a.id, userId: seeded.ua, now: () => T0 },
    { confirmName: seeded.a.name },
    noDelivery,
  );
});

afterAll(async () => {
  await su.$client.end();
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

describe('deletion cool-off', () => {
  it('erases nothing before the cool-off ends', async () => {
    const before = await countRows(su, seeded.a.id);
    const objects = (await store.list(seeded.a.id)).length;
    for (const at of [
      T0,
      new Date(T0.getTime() + 7 * DAY),
      new Date(T0.getTime() + 14 * DAY - 1),
    ]) {
      expect((await tick(at)).mine).toEqual([]);
      const { log } = captureLog();
      expect(
        await runWorkspaceErase(
          { db, log },
          { workspaceId: seeded.a.id, jobId: job.id },
          eraseDeps(store, spyEmail(), () => at),
        ),
      ).toBe('too_early');
    }
    expect(await status()).toBe('pending_cooloff');
    expect(await countRows(su, seeded.a.id)).toEqual(before);
    expect((await store.list(seeded.a.id)).length).toBe(objects);
    const [org] = await su
      .select({ deletedAt: schema.organization.deletedAt })
      .from(schema.organization)
      .where(eq(schema.organization.id, seeded.a.id));
    expect(org?.deletedAt).toBeNull();
  });

  it('schedules and enqueues the erase once the cool-off has ended', async () => {
    const end = new Date(T0.getTime() + 14 * DAY);
    const first = await tick(end);
    expect(first.mine).toEqual([{ workspaceId: seeded.a.id, jobId: job.id }]);
    expect(await status()).toBe('scheduled');
    // Still scheduled (e.g. the erase job was lost): enqueued again, not scheduled twice.
    const second = await tick(new Date(end.getTime() + 60 * 60 * 1000));
    expect(second.mine).toEqual([{ workspaceId: seeded.a.id, jobId: job.id }]);
    expect(await status()).toBe('scheduled');
    // Workspace B has no deletion: never enqueued.
    expect((await countRows(su, seeded.b.id)).organization).toBe(1);
  });
});
