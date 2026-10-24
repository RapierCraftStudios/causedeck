// Deletion receipt (#302): it records the workspace id hash, the time of every erase step and the
// audit chain head (hash chain reference), is signed, is kept on `deletion_tombstone`, reaches the
// requesting owner by email before the final step, and contains no content (no name, slug, email or
// row data).
import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import type { MemoryObjectStore } from '@causedeck/storage';
import { desc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  buildDeletionReceipt,
  receiptHash,
  receiptWorkspaceIdHash,
  requestWorkspaceDeletion,
  runWorkspaceErase,
  verifyDeletionReceipt,
  type DeletionReceipt,
} from '../index.ts';

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
  SECRET,
  seedWorkspaces,
  stepUpSession,
} from './fixtures.ts';

const T0 = new Date('2026-11-20T00:00:00.000Z');
const step = { startedAt: '2026-12-04T00:00:01.000Z', doneAt: '2026-12-04T00:00:02.000Z' };

const input = {
  workspaceId: '0190a0a0-0000-7000-8000-000000000001',
  jobId: '0190a0a0-0000-7000-8000-000000000002',
  requestedAt: T0,
  cooloffUntil: new Date(T0.getTime() + 14 * DAY),
  steps: { revoke: step, dek: step, blobs: step, rows: step, receipt: { startedAt: step.doneAt } },
  auditChainHead: 'ab'.repeat(32),
  counts: { blobs: 2, rows: 40, legalHoldInvoices: 1 },
};

describe('deletion receipt (pure)', () => {
  it('is signed, verifiable and tamper-evident', () => {
    const receipt = buildDeletionReceipt(input, SECRET);
    expect(verifyDeletionReceipt(receipt, SECRET)).toBe(true);
    expect(verifyDeletionReceipt(receipt, `${SECRET}x`)).toBe(false);
    expect(
      verifyDeletionReceipt({ ...receipt, counts: { ...receipt.counts, rows: 39 } }, SECRET),
    ).toBe(false);
    expect(receiptHash(receipt)).toMatch(/^[0-9a-f]{64}$/);
    expect(receiptHash(receipt)).toBe(receiptHash(buildDeletionReceipt(input, SECRET)));
  });

  it('names the workspace and job only by hash', () => {
    const receipt = buildDeletionReceipt(input, SECRET);
    expect(receipt.workspaceIdHash).toBe(receiptWorkspaceIdHash(input.workspaceId));
    expect(receipt.workspaceIdHash).toMatch(/^[0-9a-f]{64}$/);
    const text = JSON.stringify(receipt);
    expect(text).not.toContain(input.workspaceId);
    expect(text).not.toContain(input.jobId);
  });
});

let db: Database;
let su: Database;
let seeded: TwoTenants;
let store: MemoryObjectStore;

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

describe('deletion receipt (erase)', () => {
  it('is emailed before the final step, kept on the tombstone and holds no content', async () => {
    const ws = seeded.a;
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
    const [{ email: requesterEmail } = { email: '' }] = await su
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, seeded.ua));
    // The audit chain head just before the final step, for the hash chain reference.
    const chainHead = async () => {
      const [row] = await withWorkspace(db, { workspaceId: ws.id }, (tx) =>
        tx
          .select({ hash: sql<string>`encode(${schema.auditEvent.hash}, 'hex')` })
          .from(schema.auditEvent)
          .where(eq(schema.auditEvent.workspaceId, ws.id))
          .orderBy(desc(schema.auditEvent.createdAt), desc(schema.auditEvent.id))
          .limit(1),
      );
      return row?.hash ?? null;
    };
    let headBeforeFinal: string | null = null;
    let orgAtSend = -1;
    let tombstoneAtSend = -1;
    const email = spyEmail(async () => {
      headBeforeFinal = await chainHead();
      orgAtSend = (await countRows(su, ws.id)).organization ?? -1;
      const rows = await su
        .select()
        .from(schema.deletionTombstone)
        .where(eq(schema.deletionTombstone.workspaceId, ws.id));
      tombstoneAtSend = rows.length;
    });
    const { log } = captureLog();
    const clock = fakeClock(new Date(T0.getTime() + 14 * DAY + 1000));

    expect(
      await runWorkspaceErase(
        { db, log },
        { workspaceId: ws.id, jobId: job.id },
        eraseDeps(store, email, clock.now),
      ),
    ).toBe('erased');

    // Emailed to the requester, before the tombstone and while the workspace row still existed.
    expect(email.sent.map((m) => m.to)).toEqual([requesterEmail]);
    expect(orgAtSend).toBe(1);
    expect(tombstoneAtSend).toBe(0);

    const [tombstone] = await su
      .select()
      .from(schema.deletionTombstone)
      .where(eq(schema.deletionTombstone.workspaceId, ws.id));
    if (tombstone === undefined) throw new Error('no tombstone');
    const receipt = tombstone.receipt as unknown as DeletionReceipt;
    expect(tombstone.receiptHash).toBe(receiptHash(receipt));
    expect(verifyDeletionReceipt(receipt, SECRET)).toBe(true);
    expect(receipt.workspaceIdHash).toBe(receiptWorkspaceIdHash(ws.id));
    expect(receipt.auditChainHead).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.auditChainHead).toBe(headBeforeFinal);
    for (const name of ['revoke', 'dek', 'blobs', 'rows'] as const) {
      expect(Date.parse(receipt.steps[name].startedAt)).toBeLessThan(
        Date.parse(receipt.steps[name].doneAt),
      );
    }
    expect(receipt.counts.rows).toBeGreaterThan(0);

    // No content: neither the receipt nor the email carries the name, slug, ids or the email.
    const message = email.sent[0];
    for (const text of [JSON.stringify(receipt), message?.text ?? '', message?.subject ?? '']) {
      expect(text).not.toContain(ws.name);
      expect(text).not.toContain(ws.slug);
      expect(text).not.toContain(ws.id);
      expect(text).not.toContain(requesterEmail);
    }
    expect(message?.text).toContain(tombstone.receiptHash);
  });
});
