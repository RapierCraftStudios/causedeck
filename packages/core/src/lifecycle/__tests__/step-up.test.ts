// Step-up gate (#304): export, workspace deletion and its cancellation need the owner role and a
// passkey or TOTP verification in the caller's session within 10 minutes; account deletion needs the
// step-up. A refusal is FORBIDDEN, writes nothing (no job, no enqueue, no notification) and is
// audited: `auth.step_up_required` for a stale or missing step-up, `access.denied` for a role.
import { schema, withWorkspace, type Database } from '@causedeck/db';
import type { TwoTenants } from '@causedeck/db/testing/two-tenants';
import type { MemoryObjectStore } from '@causedeck/storage';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  cancelWorkspaceDeletion,
  getActiveWorkspaceDeletion,
  requestAccountDeletion,
  requestExport,
  requestWorkspaceDeletion,
} from '../index.ts';

import { superuserDb } from './deletion-fixtures.ts';
import { cleanup, lifecycleDb, newStore, seedWorkspaces, stepUpSession } from './fixtures.ts';

const MIN = 60 * 1000;
const NOW = new Date();
const now = () => NOW;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let db: Database;
let su: Database;
let store: MemoryObjectStore;
let seeded: TwoTenants;

beforeAll(async () => {
  db = lifecycleDb();
  su = superuserDb();
  store = newStore();
  seeded = await seedWorkspaces(db, store);
});

afterAll(async () => {
  await su
    .delete(schema.deletionJob)
    .where(
      and(eq(schema.deletionJob.kind, 'account'), eq(schema.deletionJob.userId, seeded.uboth)),
    );
  await su.$client.end();
  await cleanup(db, [seeded.a.id, seeded.b.id]);
});

async function refusal(promise: Promise<unknown>): Promise<{ code?: string; reason?: string }> {
  try {
    await promise;
  } catch (error) {
    const { code, reason } = error as { code?: string; reason?: string };
    return { ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) };
  }
  return {};
}

/** Audit events of `action` by `userId`, newest last, in any chain. */
async function events(action: string, userId: string) {
  return su
    .select({
      workspaceId: schema.auditEvent.workspaceId,
      outcome: schema.auditEvent.outcome,
      metadata: schema.auditEvent.metadata,
    })
    .from(schema.auditEvent)
    .where(and(eq(schema.auditEvent.action, action), eq(schema.auditEvent.actorUserId, userId)))
    .orderBy(schema.auditEvent.id);
}

async function exportJobsOf(workspaceId: string, userId: string) {
  return withWorkspace(db, { workspaceId }, (tx) =>
    tx
      .select({ id: schema.exportJob.id })
      .from(schema.exportJob)
      .where(eq(schema.exportJob.requestedBy, userId)),
  );
}

describe('requestExport', () => {
  it('refuses an owner without a fresh step-up, writes nothing and audits it', async () => {
    const enqueue = vi.fn(() => Promise.resolve(null));
    const ctx = { db, workspaceId: seeded.a.id, userId: seeded.ua, now };
    // Never verified, exactly 10 minutes old, from the future, expired, another user's session.
    const sessions = [
      await stepUpSession(db, seeded.ua, { at: NOW, stepUpAt: null }),
      await stepUpSession(db, seeded.ua, { at: NOW, stepUpAt: ago(10 * MIN) }),
      await stepUpSession(db, seeded.ua, { at: NOW, stepUpAt: new Date(NOW.getTime() + MIN) }),
      await stepUpSession(db, seeded.ua, { at: NOW, expiresAt: ago(1000) }),
      await stepUpSession(db, seeded.ub, { at: NOW }),
    ];
    // The seeder leaves one export row per workspace; nothing is added.
    const jobsBefore = await exportJobsOf(seeded.a.id, seeded.ua);
    for (const sessionId of sessions) {
      expect(
        await refusal(requestExport({ ...ctx, sessionId }, { scope: 'workspace' }, { enqueue })),
      ).toEqual({ code: 'FORBIDDEN', reason: 'step_up_required' });
    }
    expect(enqueue).not.toHaveBeenCalled();
    expect(await exportJobsOf(seeded.a.id, seeded.ua)).toEqual(jobsBefore);
    const audited = await events('auth.step_up_required', seeded.ua);
    expect(audited).toHaveLength(sessions.length);
    expect(audited.every((e) => e.workspaceId === seeded.a.id && e.outcome === 'denied')).toBe(
      true,
    );
    expect(audited[0]?.metadata).toEqual({ deniedAction: 'export.request' });
    expect(await events('export.requested', seeded.ua)).toEqual([]);
  });

  it('lets an owner verified within 10 minutes export', async () => {
    const enqueue = vi.fn(() => Promise.resolve(null));
    const sessionId = await stepUpSession(db, seeded.ua, { at: NOW, stepUpAt: ago(9 * MIN) });
    const job = await requestExport(
      { db, workspaceId: seeded.a.id, userId: seeded.ua, sessionId, now },
      { scope: 'workspace' },
      { enqueue },
    );
    expect(enqueue).toHaveBeenCalledWith({ workspaceId: seeded.a.id, jobId: job.id });
  });

  it('refuses other roles even with a fresh step-up, and audits access.denied', async () => {
    const enqueue = vi.fn(() => Promise.resolve(null));
    // uboth is an advocate in A: a member, so the denial goes to A's chain.
    expect(
      await refusal(
        requestExport(
          {
            db,
            workspaceId: seeded.a.id,
            userId: seeded.uboth,
            sessionId: await stepUpSession(db, seeded.uboth),
          },
          { scope: 'workspace' },
          { enqueue },
        ),
      ),
    ).toEqual({ code: 'FORBIDDEN' });
    // ub is not a member of A: the denial is account-level.
    expect(
      (
        await refusal(
          requestExport(
            {
              db,
              workspaceId: seeded.a.id,
              userId: seeded.ub,
              sessionId: await stepUpSession(db, seeded.ub),
            },
            { scope: 'workspace' },
            { enqueue },
          ),
        )
      ).code,
    ).toBe('FORBIDDEN');
    expect(enqueue).not.toHaveBeenCalled();
    const member = await events('access.denied', seeded.uboth);
    expect(member.at(-1)).toMatchObject({
      workspaceId: seeded.a.id,
      outcome: 'denied',
      metadata: { member: true, deniedAction: 'export.request', reason: 'role' },
    });
    const outsider = await events('access.denied', seeded.ub);
    expect(outsider.at(-1)).toMatchObject({
      workspaceId: null,
      metadata: { member: false, deniedAction: 'export.request', reason: 'role' },
    });
    expect(await events('auth.step_up_required', seeded.uboth)).toEqual([]);
  });
});

describe('workspace deletion', () => {
  const delivered: unknown[] = [];
  const deps = {
    enqueueDelivery: (job: unknown) => {
      delivered.push(job);
      return Promise.resolve(null);
    },
  };

  it('request: stale step-up is refused before anything is written or sent', async () => {
    const ws = seeded.b;
    const sessionId = await stepUpSession(db, seeded.ub, { at: NOW, stepUpAt: ago(11 * MIN) });
    expect(
      await refusal(
        requestWorkspaceDeletion(
          { db, workspaceId: ws.id, userId: seeded.ub, sessionId, now },
          { confirmName: ws.name },
          deps,
        ),
      ),
    ).toEqual({ code: 'FORBIDDEN', reason: 'step_up_required' });
    expect(delivered).toEqual([]);
    expect(await getActiveWorkspaceDeletion({ db, workspaceId: ws.id, userId: seeded.ub })).toBe(
      null,
    );
    expect((await events('auth.step_up_required', seeded.ub)).at(-1)).toMatchObject({
      workspaceId: ws.id,
      metadata: { deniedAction: 'workspace.delete' },
    });
  });

  it('request: an advocate with a fresh step-up is refused and audited', async () => {
    const ws = seeded.b;
    expect(
      (
        await refusal(
          requestWorkspaceDeletion(
            {
              db,
              workspaceId: ws.id,
              userId: seeded.uboth,
              sessionId: await stepUpSession(db, seeded.uboth),
            },
            { confirmName: ws.name },
            deps,
          ),
        )
      ).code,
    ).toBe('FORBIDDEN');
    expect((await events('access.denied', seeded.uboth)).at(-1)).toMatchObject({
      workspaceId: ws.id,
      metadata: { member: true, deniedAction: 'workspace.delete', reason: 'role' },
    });
  });

  it('cancel: refused without a fresh step-up, allowed with one', async () => {
    const ws = seeded.b;
    const job = await requestWorkspaceDeletion(
      {
        db,
        workspaceId: ws.id,
        userId: seeded.ub,
        sessionId: await stepUpSession(db, seeded.ub, { at: NOW }),
        now,
      },
      { confirmName: ws.name },
      deps,
    );
    expect(job.status).toBe('pending_cooloff');
    const notified = delivered.length;

    const stale = await stepUpSession(db, seeded.ub, { at: NOW, stepUpAt: null });
    expect(
      await refusal(
        cancelWorkspaceDeletion(
          { db, workspaceId: ws.id, userId: seeded.ub, sessionId: stale, now },
          job.id,
          deps,
        ),
      ),
    ).toEqual({ code: 'FORBIDDEN', reason: 'step_up_required' });
    expect(
      (await getActiveWorkspaceDeletion({ db, workspaceId: ws.id, userId: seeded.ub }))?.status,
    ).toBe('pending_cooloff');
    expect(delivered).toHaveLength(notified);
    expect((await events('auth.step_up_required', seeded.ub)).at(-1)).toMatchObject({
      workspaceId: ws.id,
      metadata: { deniedAction: 'workspace.delete_cancel' },
    });

    const fresh = await stepUpSession(db, seeded.ub, { at: NOW, stepUpAt: ago(MIN) });
    const cancelled = await cancelWorkspaceDeletion(
      { db, workspaceId: ws.id, userId: seeded.ub, sessionId: fresh, now },
      job.id,
      deps,
    );
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('requestAccountDeletion', () => {
  const accountJobs = () =>
    su
      .select({ id: schema.deletionJob.id })
      .from(schema.deletionJob)
      .where(
        and(
          eq(schema.deletionJob.kind, 'account'),
          eq(schema.deletionJob.userId, seeded.uboth),
          inArray(schema.deletionJob.status, ['scheduled', 'running']),
        ),
      );

  it('refuses without a fresh step-up, account-level audit, nothing scheduled', async () => {
    const enqueue = vi.fn(() => Promise.resolve(null));
    const sessionId = await stepUpSession(db, seeded.uboth, { at: NOW, stepUpAt: ago(10 * MIN) });
    expect(
      await refusal(
        requestAccountDeletion({ db, userId: seeded.uboth, sessionId, now }, { enqueue }),
      ),
    ).toEqual({ code: 'FORBIDDEN', reason: 'step_up_required' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(await accountJobs()).toEqual([]);
    expect((await events('auth.step_up_required', seeded.uboth)).at(-1)).toMatchObject({
      workspaceId: null,
      outcome: 'denied',
      metadata: { deniedAction: 'account.delete' },
    });
  });

  it('schedules the deletion with a fresh step-up', async () => {
    const enqueue = vi.fn(() => Promise.resolve(null));
    const sessionId = await stepUpSession(db, seeded.uboth, { at: NOW, stepUpAt: ago(MIN) });
    const job = await requestAccountDeletion(
      { db, userId: seeded.uboth, sessionId, now },
      { enqueue },
    );
    expect(job.status).toBe('scheduled');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
