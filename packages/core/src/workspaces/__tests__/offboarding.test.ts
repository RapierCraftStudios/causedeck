// Member offboarding against a real Postgres (Testcontainers, #178). Every test runs in a
// rolled-back transaction; the service's own transactions become savepoints inside it.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  auditSink,
  clearReassignProviders,
  createWorkspace,
  memberRole,
  noopAuditSink,
  registerReassignProvider,
  setAuditSink,
  WorkspaceError,
  type AuditEvent,
  type WorkspaceRole,
} from '../index.ts';
import * as core from '../index.ts';

// removeMember runs inside the workspace's scope, as the members actions call it (`withWorkspace`).
const removeMember = (tx: Transaction, request: Parameters<typeof core.removeMember>[1]) =>
  inWorkspace(tx, request.workspaceId, (s) => core.removeMember(s, request));

async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'User', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function addMember(
  tx: Transaction,
  workspaceId: string,
  role: WorkspaceRole,
  userId?: string,
): Promise<{ userId: string; memberId: string }> {
  const id = userId ?? (await newUser(tx));
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId: id, role })
      .returning({ id: schema.member.id }),
  );
  if (!row) throw new Error('member insert failed');
  return { userId: id, memberId: row.id };
}

async function newWorkspace(tx: Transaction, ownerId: string): Promise<string> {
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Chambers ${randomUUID().slice(0, 8)}` },
  });
  return workspace.id;
}

async function newSession(
  tx: Transaction,
  userId: string,
  activeOrganizationId: string | null,
): Promise<string> {
  const [row] = await tx
    .insert(schema.session)
    .values({
      userId,
      activeOrganizationId,
      token: randomUUID(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning({ id: schema.session.id });
  if (!row) throw new Error('session insert failed');
  return row.id;
}

async function sessionExists(tx: Transaction, id: string): Promise<boolean> {
  const rows = await tx
    .select({ id: schema.session.id })
    .from(schema.session)
    .where(eq(schema.session.id, id));
  return rows.length === 1;
}

async function memberStatus(
  tx: Transaction,
  workspaceId: string,
  memberId: string,
): Promise<string | undefined> {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ status: schema.member.status })
      .from(schema.member)
      .where(and(eq(schema.member.id, memberId))),
  );
  return row?.status;
}

async function expectCode(promise: Promise<unknown>, code: WorkspaceError['code']): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  expect((error as WorkspaceError).code).toBe(code);
}

function openWorkProvider(open: number) {
  return {
    name: 'tasks',
    countOpen: vi.fn(() => Promise.resolve(open)),
    reassign: vi.fn(() => Promise.resolve()),
  };
}

afterEach(() => {
  clearReassignProviders();
  setAuditSink(null);
});

describe('removeMember offboarding', () => {
  it('removes a member with no open work without a reassignment', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const junior = await addMember(tx, workspaceId, 'junior');

      await removeMember(tx, { workspaceId, actorUserId: ownerId, memberId: junior.memberId });
      expect(await memberStatus(tx, workspaceId, junior.memberId)).toBe('removed');
      expect(await memberRole(tx, junior.userId, workspaceId)).toBeNull();
    });
  });

  it('requires a reassignment choice when open work exists, then reassigns it', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const junior = await addMember(tx, workspaceId, 'junior');
      const advocate = await addMember(tx, workspaceId, 'advocate');
      const provider = openWorkProvider(3);
      registerReassignProvider(provider);
      const request = { workspaceId, actorUserId: ownerId, memberId: junior.memberId };

      await expectCode(removeMember(tx, request), 'VALIDATION');
      expect(await memberStatus(tx, workspaceId, junior.memberId)).toBe('active');
      expect(provider.reassign).not.toHaveBeenCalled();

      await expectCode(removeMember(tx, { ...request, reassignTo: junior.memberId }), 'VALIDATION');
      await expectCode(removeMember(tx, { ...request, reassignTo: randomUUID() }), 'NOT_FOUND');
      expect(await memberStatus(tx, workspaceId, junior.memberId)).toBe('active');

      await removeMember(tx, { ...request, reassignTo: advocate.memberId });
      expect(provider.reassign).toHaveBeenCalledWith(
        expect.anything(),
        workspaceId,
        junior.userId,
        advocate.userId,
      );
      expect(await memberStatus(tx, workspaceId, junior.memberId)).toBe('removed');
    });
  });

  it('revokes only the sessions scoped to that workspace', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const otherWorkspaceId = await newWorkspace(tx, ownerId);
      const clerk = await addMember(tx, workspaceId, 'clerk');
      await addMember(tx, otherWorkspaceId, 'clerk', clerk.userId);

      const scoped = await newSession(tx, clerk.userId, workspaceId);
      const elsewhere = await newSession(tx, clerk.userId, otherWorkspaceId);
      const unscoped = await newSession(tx, clerk.userId, null);
      const ownerSession = await newSession(tx, ownerId, workspaceId);

      await removeMember(tx, { workspaceId, actorUserId: ownerId, memberId: clerk.memberId });
      expect(await sessionExists(tx, scoped)).toBe(false);
      expect(await sessionExists(tx, elsewhere)).toBe(true);
      expect(await sessionExists(tx, unscoped)).toBe(true);
      expect(await sessionExists(tx, ownerSession)).toBe(true);
      expect(await memberRole(tx, clerk.userId, otherWorkspaceId)).toBe('clerk');
    });
  });

  it('writes an audit event through the AuditSink', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const junior = await addMember(tx, workspaceId, 'junior');
      const advocate = await addMember(tx, workspaceId, 'advocate');
      const events: AuditEvent[] = [];
      setAuditSink({
        write: (_tx, event) => {
          events.push(event);
          return Promise.resolve();
        },
      });

      await removeMember(tx, {
        workspaceId,
        actorUserId: ownerId,
        memberId: junior.memberId,
        reassignTo: advocate.memberId,
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'member.removed',
        workspaceId,
        actorUserId: ownerId,
        targetUserId: junior.userId,
        reassignedTo: advocate.userId,
      });
      expect(events[0]?.at).toBeInstanceOf(Date);
    });
  });

  it('defaults to a no-op sink and setAuditSink(null) restores it', async () => {
    const write = vi.fn(() => Promise.resolve());
    setAuditSink({ write });
    setAuditSink(null);
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const viewer = await addMember(tx, workspaceId, 'viewer');
      await removeMember(tx, { workspaceId, actorUserId: ownerId, memberId: viewer.memberId });
    });
    expect(write).not.toHaveBeenCalled();
    await expect(noopAuditSink.write({} as Transaction, {} as AuditEvent)).resolves.toBeUndefined();
    expect(auditSink).toBeDefined();
  });

  it('still refuses to remove the last owner', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const [owner] = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(eq(schema.member.organizationId, workspaceId)),
      );
      await expectCode(
        removeMember(tx, { workspaceId, actorUserId: ownerId, memberId: owner?.id ?? '' }),
        'CONFLICT',
      );
    });
  });
});
