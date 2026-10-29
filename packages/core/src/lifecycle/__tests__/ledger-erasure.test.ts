// DPDP erasure of the fee ledger (#83, ADR 0048): the workspace erase anonymises every client
// ledger line (text cleared, `anonymised_at` set, money kept) before the purge batches begin, so a
// worker killed right after that step leaves no ledger text behind; the resumed run still erases.
import { schema } from '@causedeck/db';
import type { Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import type { MemoryObjectStore } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestWorkspaceDeletion, runWorkspaceErase } from '../index.ts';

import {
  countRows,
  DAY,
  eraseDeps,
  fakeClock,
  noDelivery,
  spyEmail,
  superuserDb,
} from './deletion-fixtures.ts';
import {
  captureLog,
  cleanup,
  lifecycleDb,
  newStore,
  seedWorkspaces,
  stepUpSession,
} from './fixtures.ts';

const T0 = new Date('2026-11-25T00:00:00.000Z');

let db: Database;
let su: Database;
let seeded: TwoTenants;
let store: MemoryObjectStore;

const ledgerOf = (workspaceId: string) =>
  su
    .select()
    .from(schema.clientLedgerEntry)
    .where(eq(schema.clientLedgerEntry.workspaceId, workspaceId));

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

describe('workspace erase anonymises the fee ledger', () => {
  it('clears ledger text, keeps amounts, leaves other tenants alone, then erases', async () => {
    const ws = seeded.a;
    // The two-tenant seeder gives each workspace one described ledger line; make sure of it.
    const before = await ledgerOf(ws.id);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.description !== null && r.anonymisedAt === null)).toBe(true);
    const otherBefore = await ledgerOf(seeded.b.id);

    const job = await requestWorkspaceDeletion(
      {
        db,
        workspaceId: ws.id,
        userId: seeded.ua,
        sessionId: await stepUpSession(db, seeded.ua, { at: T0 }),
        now: () => T0,
      },
      { confirmName: ws.name },
      noDelivery,
    );
    const clock = fakeClock(new Date(T0.getTime() + 14 * DAY + 1000));
    const { log } = captureLog();
    const email = spyEmail();

    // A worker killed straight after the anonymisation step: the lines are already anonymised.
    await expect(
      runWorkspaceErase(
        { db, log },
        { workspaceId: ws.id, jobId: job.id },
        eraseDeps(store, email, clock.now, {
          crashAfter: (at) => {
            if (at === 'rows:ledger_anonymised') throw new Error('killed after ledger');
          },
        }),
      ),
    ).rejects.toThrow('killed after ledger');
    const mid = await ledgerOf(ws.id);
    expect(mid).toHaveLength(before.length);
    for (const row of mid) {
      expect(row.description).toBeNull();
      expect(row.anonymisedAt).toBeInstanceOf(Date);
      const was = before.find((b) => b.id === row.id);
      expect(row.amountPaise).toBe(was?.amountPaise);
    }
    // Another workspace's ledger is untouched.
    expect(await ledgerOf(seeded.b.id)).toEqual(otherBefore);

    // The resumed run completes the erase.
    expect(
      await runWorkspaceErase(
        { db, log },
        { workspaceId: ws.id, jobId: job.id },
        eraseDeps(store, email, clock.now),
      ),
    ).toBe('erased');
    expect((await countRows(su, ws.id)).client_ledger_entry).toBe(0);
    expect(await ledgerOf(seeded.b.id)).toEqual(otherBefore);
  });
});
