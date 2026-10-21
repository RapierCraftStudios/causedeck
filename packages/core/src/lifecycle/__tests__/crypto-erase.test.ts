// Crypto-erase proof (#302): after a workspace is erased, ciphertext stored before cannot be
// decrypted even with the KEK (`KEY_DESTROYED`), the object storage prefix is empty, and a row count
// for the workspace id across every tenant table (and the global tables that name a workspace)
// returns zero. Workspace B is untouched and still decrypts.
import type { Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import {
  decryptForWorkspace,
  ensureWorkspaceKey,
  type MemoryObjectStore,
} from '@causedeck/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestWorkspaceDeletion, runWorkspaceErase } from '../index.ts';

import {
  addSession,
  countRows,
  DAY,
  eraseDeps,
  fakeClock,
  noDelivery,
  spyEmail,
  storeEncrypted,
  superuserDb,
} from './deletion-fixtures.ts';
import {
  captureLog,
  cleanup,
  lifecycleDb,
  newStore,
  readAll,
  seedWorkspaces,
  stepUpSession,
  testKeys,
} from './fixtures.ts';

const T0 = new Date('2026-11-10T00:00:00.000Z');

let db: Database;
let su: Database;
let seeded: TwoTenants;
let store: MemoryObjectStore;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

beforeAll(async () => {
  db = lifecycleDb();
  su = superuserDb();
  store = newStore();
  seeded = await seedWorkspaces(db, store);
});

afterAll(async () => {
  await su.$client.end();
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

describe('crypto-erase proof', () => {
  it('leaves no key, no object and no row of the workspace', async () => {
    const a = seeded.a.id;
    const b = seeded.b.id;
    const stored = await storeEncrypted(db, store, a);
    const other = await storeEncrypted(db, store, b);
    await addSession(db, a, seeded.ua);
    expect(
      (await readAll(decryptForWorkspace(db, testKeys(), a, [stored.ciphertext]))).equals(
        stored.plaintext,
      ),
    ).toBe(true);
    const before = await countRows(su, a);
    expect(before.organization).toBe(1);
    expect(before.session).toBe(1);

    const job = await requestWorkspaceDeletion(
      {
        db,
        workspaceId: a,
        userId: seeded.ua,
        sessionId: await stepUpSession(db, seeded.ua, { at: T0 }),
        now: () => T0,
      },
      { confirmName: seeded.a.name },
      noDelivery,
    );
    const { log } = captureLog();
    const clock = fakeClock(new Date(T0.getTime() + 14 * DAY + 1000));
    expect(
      await runWorkspaceErase(
        { db, log },
        { workspaceId: a, jobId: job.id },
        eraseDeps(store, spyEmail(), clock.now),
      ),
    ).toBe('erased');

    // The ciphertext is unreadable, even holding the KEK, and no new key can be made.
    expect(await codeOf(readAll(decryptForWorkspace(db, testKeys(), a, [stored.ciphertext])))).toBe(
      'KEY_DESTROYED',
    );
    expect(await codeOf(ensureWorkspaceKey(db, testKeys(), a))).toBe('KEY_DESTROYED');
    // The storage prefix is empty.
    expect(await store.list(a)).toEqual([]);
    // Zero rows for the workspace id in every tenant table.
    const after = await countRows(su, a);
    expect(Object.entries(after).filter(([, n]) => n !== 0)).toEqual([]);

    // Workspace B keeps its rows, objects and key.
    expect((await countRows(su, b)).organization).toBe(1);
    expect((await store.list(b)).length).toBeGreaterThan(0);
    expect(
      (await readAll(decryptForWorkspace(db, testKeys(), b, [other.ciphertext]))).equals(
        other.plaintext,
      ),
    ).toBe(true);
  });
});
