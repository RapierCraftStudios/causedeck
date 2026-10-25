// Clerk-led onboarding (#505) against a real Postgres: the clerk asks for approval, a member with
// `workspace.manage` approves it, and nobody else can do either. Approval grants no permission.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  approveClerkSetup,
  createWorkspace,
  getClerkSetup,
  requestClerkSetupApproval,
  WorkspaceError,
  type WorkspaceRole,
} from '../index.ts';

async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'Member', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function addMember(tx: Transaction, workspaceId: string, role: WorkspaceRole) {
  const userId = await newUser(tx);
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId, role })
      .returning({ id: schema.member.id }),
  );
  if (!row) throw new Error('member insert failed');
  return { userId, memberId: row.id };
}

async function setup(tx: Transaction) {
  const ownerId = await newUser(tx);
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Clerk ${randomUUID().slice(0, 8)}` },
  });
  const clerk = await addMember(tx, workspace.id, 'clerk');
  return { ownerId, workspaceId: workspace.id, clerk };
}

describe('clerk setup approval', () => {
  it('starts with no status, then pending after the clerk asks, then approved by the senior', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, clerk } = await setup(tx);
      const list = () => inWorkspace(tx, workspaceId, (s) => getClerkSetup(s, workspaceId));
      expect((await list())[0]).toMatchObject({ memberId: clerk.memberId, status: null });

      const pending = await inWorkspace(tx, workspaceId, (s) =>
        requestClerkSetupApproval(s, { workspaceId, actorUserId: clerk.userId }),
      );
      expect(pending).toMatchObject({ status: 'pending', decidedAt: null });

      const now = new Date('2026-10-24T10:00:00Z');
      const approved = await inWorkspace(tx, workspaceId, (s) =>
        approveClerkSetup(s, { workspaceId, actorUserId: ownerId, memberId: clerk.memberId, now }),
      );
      expect(approved).toMatchObject({ status: 'approved', decidedAt: now });
      // Asking again keeps the approval.
      const again = await inWorkspace(tx, workspaceId, (s) =>
        requestClerkSetupApproval(s, { workspaceId, actorUserId: clerk.userId }),
      );
      expect(again.status).toBe('approved');
    });
  });

  it('rejects approval before the clerk asked, and a non-clerk asking', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId, clerk } = await setup(tx);
      await expect(
        inWorkspace(tx, workspaceId, (s) =>
          approveClerkSetup(s, { workspaceId, actorUserId: ownerId, memberId: clerk.memberId }),
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(
        inWorkspace(tx, workspaceId, (s) =>
          requestClerkSetupApproval(s, { workspaceId, actorUserId: ownerId }),
        ),
      ).rejects.toBeInstanceOf(WorkspaceError);
    });
  });

  it('lets only a member with workspace.manage approve: the clerk and a junior cannot', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, clerk } = await setup(tx);
      const junior = await addMember(tx, workspaceId, 'junior');
      await inWorkspace(tx, workspaceId, (s) =>
        requestClerkSetupApproval(s, { workspaceId, actorUserId: clerk.userId }),
      );
      for (const actorUserId of [clerk.userId, junior.userId]) {
        await expect(
          inWorkspace(tx, workspaceId, (s) =>
            approveClerkSetup(s, { workspaceId, actorUserId, memberId: clerk.memberId }),
          ),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      }
      const [entry] = await inWorkspace(tx, workspaceId, (s) => getClerkSetup(s, workspaceId));
      expect(entry?.status).toBe('pending');
    });
  });
});
