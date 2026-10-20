// Workspace deletion (#302): the request needs the exact workspace name and an owner, starts a
// 14-day cool-off, notifies the owners and is cancellable by any owner; the erase runs revoke →
// destroy DEK → delete blobs → purge rows → receipt + tombstone, finishes within 24 h of the
// cool-off end on a fake clock, and resumes after a crash at any step without doing anything twice.
import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import { getWorkspaceDek, type MemoryObjectStore } from '@causedeck/storage';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cancelWorkspaceDeletion,
  DELETION_COOLOFF_MS,
  getActiveWorkspaceDeletion,
  requestWorkspaceDeletion,
  runDeletionTick,
  runWorkspaceErase,
  type DeletionReceipt,
} from '../index.ts';

import {
  addSession,
  countRows,
  DAY,
  eraseDeps,
  fakeClock,
  makeOwner,
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
  testKeys,
} from './fixtures.ts';

const T0 = new Date('2026-11-01T04:30:00.000Z');

let db: Database;
let su: Database;
let first: TwoTenants;
let second: TwoTenants;
let store: MemoryObjectStore;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

async function jobRow(workspaceId: string, id: string) {
  const [row] = await withWorkspace(db, { workspaceId }, (tx) =>
    tx.select().from(schema.deletionJob).where(eq(schema.deletionJob.id, id)),
  );
  return row;
}

beforeAll(async () => {
  db = lifecycleDb();
  su = superuserDb();
  store = newStore();
  first = await seedWorkspaces(db, store);
  second = await seedWorkspaces(db, store);
});

afterAll(async () => {
  await su.$client.end();
  await cleanup(db, [first.a.id, first.b.id, second.a.id, second.b.id]);
});

describe('requestWorkspaceDeletion', () => {
  it('needs the exact workspace name and an owner; nothing is created otherwise', async () => {
    const ws = first.b;
    const ctx = {
      db,
      workspaceId: ws.id,
      userId: first.ub,
      sessionId: await stepUpSession(db, first.ub, { at: T0 }),
      now: () => T0,
    };
    expect(
      await codeOf(requestWorkspaceDeletion(ctx, { confirmName: 'wrong name' }, noDelivery)),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        requestWorkspaceDeletion(ctx, { confirmName: ws.name.toUpperCase() }, noDelivery),
      ),
    ).toBe('VALIDATION');
    // uboth is an advocate in B, not an owner.
    expect(
      await codeOf(
        requestWorkspaceDeletion(
          {
            db,
            workspaceId: ws.id,
            userId: first.uboth,
            sessionId: await stepUpSession(db, first.uboth),
          },
          { confirmName: ws.name },
          noDelivery,
        ),
      ),
    ).toBe('FORBIDDEN');
    expect(await getActiveWorkspaceDeletion({ db, workspaceId: ws.id, userId: first.ub })).toBe(
      null,
    );
  });

  it('starts a 14-day cool-off, audits it, notifies the owners and is idempotent', async () => {
    const ws = first.b;
    const delivered: unknown[] = [];
    const deps = {
      enqueueDelivery: (job: unknown) => {
        delivered.push(job);
        return Promise.resolve(null);
      },
    };
    const ctx = {
      db,
      workspaceId: ws.id,
      userId: first.ub,
      sessionId: await stepUpSession(db, first.ub, { at: T0 }),
      now: () => T0,
    };
    const job = await requestWorkspaceDeletion(ctx, { confirmName: ` ${ws.name} ` }, deps);
    expect(job.status).toBe('pending_cooloff');
    expect(job.cooloffUntil?.getTime()).toBe(T0.getTime() + DELETION_COOLOFF_MS);
    expect(job.eraseAfter?.getTime()).toBe(T0.getTime() + 14 * DAY);

    const again = await requestWorkspaceDeletion(ctx, { confirmName: ws.name }, deps);
    expect(again.id).toBe(job.id);

    await withWorkspace(db, { workspaceId: ws.id }, async (tx) => {
      const events = await tx
        .select()
        .from(schema.auditEvent)
        .where(
          and(
            eq(schema.auditEvent.workspaceId, ws.id),
            eq(schema.auditEvent.action, 'workspace.deletion_requested'),
          ),
        );
      expect(events).toHaveLength(1);
      expect(events[0]?.metadata).toEqual({
        jobId: job.id,
        cooloffUntil: new Date(T0.getTime() + 14 * DAY).toISOString(),
      });
      const notices = await tx
        .select()
        .from(schema.notification)
        .where(
          and(
            eq(schema.notification.workspaceId, ws.id),
            eq(schema.notification.category, 'security.alert'),
          ),
        );
      expect(notices.map((n) => n.userId)).toEqual([first.ub]);
      expect(notices[0]?.title).toContain(ws.name);
    });
    // Every active member sees the pending deletion (the banner); a non-member sees nothing.
    expect(
      (await getActiveWorkspaceDeletion({ db, workspaceId: ws.id, userId: first.uboth }))?.id,
    ).toBe(job.id);
    expect(await getActiveWorkspaceDeletion({ db, workspaceId: ws.id, userId: first.ua })).toBe(
      null,
    );
  });

  it('any owner can cancel during the cool-off; a cancelled deletion is never erased', async () => {
    const ws = first.b;
    await makeOwner(db, ws.id, first.uboth);
    const pending = await getActiveWorkspaceDeletion({ db, workspaceId: ws.id, userId: first.ub });
    if (pending === null) throw new Error('expected a pending deletion');
    // A different owner than the requester cancels.
    const cancelled = await cancelWorkspaceDeletion(
      {
        db,
        workspaceId: ws.id,
        userId: first.uboth,
        sessionId: await stepUpSession(db, first.uboth),
      },
      pending.id,
      noDelivery,
    );
    expect(cancelled.status).toBe('cancelled');
    expect(await getActiveWorkspaceDeletion({ db, workspaceId: ws.id, userId: first.ub })).toBe(
      null,
    );

    const enqueued: unknown[] = [];
    const { log } = captureLog();
    await runDeletionTick(
      { db, log },
      {
        now: () => new Date(T0.getTime() + 15 * DAY),
        enqueue: (job) => {
          enqueued.push(job);
          return Promise.resolve(null);
        },
      },
    );
    expect(enqueued).not.toContainEqual({ workspaceId: ws.id, jobId: pending.id });
    const outcome = await runWorkspaceErase(
      { db, log },
      { workspaceId: ws.id, jobId: pending.id },
      eraseDeps(store, spyEmail(), () => new Date(T0.getTime() + 15 * DAY)),
    );
    expect(outcome).toBe('cancelled');
    expect((await countRows(su, ws.id)).organization).toBe(1);
  });
});

describe('runWorkspaceErase', () => {
  it('erases in order, within 24 h of the cool-off end, and is idempotent', async () => {
    const ws = first.a;
    const requestCtx = {
      db,
      workspaceId: ws.id,
      userId: first.ua,
      sessionId: await stepUpSession(db, first.ua, { at: T0 }),
      now: () => T0,
    };
    const job = await requestWorkspaceDeletion(requestCtx, { confirmName: ws.name }, noDelivery);
    await addSession(db, ws.id, first.ua);
    const clock = fakeClock(new Date(T0.getTime() + 14 * DAY + 60 * 60 * 1000));

    // The tick an hour after the cool-off ends schedules and enqueues it.
    const enqueued: { workspaceId: string; jobId: string }[] = [];
    const { log } = captureLog();
    await runDeletionTick(
      { db, log },
      {
        now: clock.now,
        enqueue: (j) => {
          enqueued.push(j);
          return Promise.resolve(null);
        },
      },
    );
    expect(enqueued).toContainEqual({ workspaceId: ws.id, jobId: job.id });
    expect((await jobRow(ws.id, job.id))?.status).toBe('scheduled');

    // Observe the order: when the first object is deleted, access is revoked and the DEK is gone.
    const seen: string[] = [];
    const deletingStore: MemoryObjectStore = {
      ...store,
      list: (id, options) => store.list(id, options),
      delete: async (key) => {
        if (!seen.includes('first-delete')) {
          seen.push('first-delete');
          const counts = await countRows(su, ws.id);
          seen.push(`sessions:${String(counts.session)}`);
          seen.push(`integration-tokens:${String(counts.workspace_integration)}`);
          seen.push(`dek:${String(await codeOf(getWorkspaceDek(db, testKeys(), ws.id)))}`);
          seen.push(`members:${(counts.member ?? 0) > 0 ? 'present' : 'gone'}`);
        }
        await store.delete(key);
      },
    };
    const email = spyEmail(async () => {
      // The receipt goes out before the final step: the workspace row still exists then.
      seen.push(`email-org:${String((await countRows(su, ws.id)).organization)}`);
    });
    const outcome = await runWorkspaceErase(
      { db, log },
      { workspaceId: ws.id, jobId: job.id },
      eraseDeps(deletingStore, email, clock.now),
    );
    expect(outcome).toBe('erased');
    // Sessions and integration tokens were revoked and the DEK destroyed before any blob was deleted; rows were still
    // there (members purged later, in step 4), and the receipt was emailed before the final step.
    expect(seen).toEqual([
      'first-delete',
      'sessions:0',
      'integration-tokens:0',
      'dek:KEY_DESTROYED',
      'members:present',
      'email-org:1',
    ]);
    expect(email.sent).toHaveLength(1);

    const [tombstone] = await su
      .select()
      .from(schema.deletionTombstone)
      .where(eq(schema.deletionTombstone.workspaceId, ws.id));
    const receipt = tombstone?.receipt as unknown as DeletionReceipt;
    const s = receipt.steps;
    const times = [
      s.revoke.startedAt,
      s.revoke.doneAt,
      s.dek.startedAt,
      s.dek.doneAt,
      s.blobs.startedAt,
      s.blobs.doneAt,
      s.rows.startedAt,
      s.rows.doneAt,
      s.receipt.startedAt,
    ].map((t) => new Date(t).getTime());
    expect([...times].sort((x, y) => x - y)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
    // Within 24 h of the end of the cool-off (and so far inside the 30-day SLA).
    const cooloffEnd = T0.getTime() + 14 * DAY;
    expect(Math.max(...times) - cooloffEnd).toBeLessThan(DAY);
    expect(Math.max(...times) - T0.getTime()).toBeLessThan(30 * DAY);

    // Nothing of the workspace is left; a second run changes nothing.
    expect(Object.values(await countRows(su, ws.id)).every((n) => n === 0)).toBe(true);
    expect(
      await runWorkspaceErase(
        { db, log },
        { workspaceId: ws.id, jobId: job.id },
        eraseDeps(store, email, clock.now),
      ),
    ).toBe('already_erased');
    expect(email.sent).toHaveLength(1);
  });

  it('resumes after the worker dies at any step and does nothing twice (kill-worker)', async () => {
    const ws = second.a;
    const job = await requestWorkspaceDeletion(
      {
        db,
        workspaceId: ws.id,
        userId: second.ua,
        sessionId: await stepUpSession(db, second.ua, { at: T0 }),
        now: () => T0,
      },
      { confirmName: ws.name },
      noDelivery,
    );
    const clock = fakeClock(new Date(T0.getTime() + 14 * DAY + 1000));
    const email = spyEmail();
    const { log } = captureLog();
    const crashPoints = [
      'revoke',
      'dek',
      'blobs:page',
      'rows:notification',
      'rows:member',
      'receipt:emailed',
    ];
    const reached: string[] = [];
    for (const point of crashPoints) {
      const outcome = runWorkspaceErase(
        { db, log },
        { workspaceId: ws.id, jobId: job.id },
        eraseDeps(store, email, clock.now, {
          crashAfter: (at) => {
            if (at === point) {
              reached.push(at);
              throw new Error(`worker killed after ${at}`);
            }
          },
        }),
      );
      await expect(outcome).rejects.toThrow(`worker killed after ${point}`);
      const row = await jobRow(ws.id, job.id);
      expect(row?.status).toBe('running');
    }
    expect(reached).toEqual(crashPoints);

    // The final run completes; the receipt was sent once despite the crash right after sending.
    expect(
      await runWorkspaceErase(
        { db, log },
        { workspaceId: ws.id, jobId: job.id },
        eraseDeps(store, email, clock.now),
      ),
    ).toBe('erased');
    expect(email.sent).toHaveLength(1);
    expect(Object.values(await countRows(su, ws.id)).every((n) => n === 0)).toBe(true);
    expect(await store.list(ws.id)).toEqual([]);
    // The other workspace is untouched.
    expect((await countRows(su, second.b.id)).organization).toBe(1);
    expect((await store.list(second.b.id)).length).toBeGreaterThan(0);
  });

  it('a running erase can no longer be cancelled', async () => {
    const ws = second.b;
    const job = await requestWorkspaceDeletion(
      {
        db,
        workspaceId: ws.id,
        userId: second.ub,
        sessionId: await stepUpSession(db, second.ub, { at: T0 }),
        now: () => T0,
      },
      { confirmName: ws.name },
      noDelivery,
    );
    await withWorkspace(db, { workspaceId: ws.id }, (tx) =>
      tx
        .update(schema.deletionJob)
        .set({ status: 'running' })
        .where(eq(schema.deletionJob.id, job.id)),
    );
    const error = await cancelWorkspaceDeletion(
      { db, workspaceId: ws.id, userId: second.ub, sessionId: await stepUpSession(db, second.ub) },
      job.id,
      noDelivery,
    ).catch((e: unknown) => e);
    expect((error as { reason?: string }).reason).toBe('DELETION_NOT_CANCELLABLE');
    expect((await jobRow(ws.id, job.id))?.status).toBe('running');
  });
});
