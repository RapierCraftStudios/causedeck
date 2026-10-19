// Read helpers behind the members page (#181) against a real Postgres (Testcontainers): pending
// invitations, a member's open work before removal and each member's last activity.
import { randomUUID } from 'node:crypto';

import type { Mailer } from '@causedeck/auth/mailer';
import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearReassignProviders,
  countOpenWork,
  createWorkspace,
  inviteMember,
  listMembers,
  listPendingInvitations,
  registerReassignProvider,
  revokeInvitation,
  softDeleteWorkspace,
  type WorkspaceRole,
} from '../index.ts';

const mailer: Mailer = { send: () => Promise.resolve() };
const APP_URL = 'http://localhost:3000';

async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'User', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function addMember(tx: Transaction, workspaceId: string, role: WorkspaceRole) {
  const userId = await newUser(tx);
  const [row] = await tx
    .insert(schema.member)
    .values({ organizationId: workspaceId, userId, role })
    .returning({ id: schema.member.id });
  if (!row) throw new Error('member insert failed');
  return { userId, memberId: row.id };
}

async function newWorkspace(tx: Transaction, ownerId: string): Promise<string> {
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Chambers ${randomUUID().slice(0, 8)}` },
  });
  return workspace.id;
}

function invite(tx: Transaction, workspaceId: string, actorUserId: string, email: string) {
  return inviteMember(tx, {
    workspaceId,
    actorUserId,
    input: { email, role: 'junior' },
    mailer,
    appUrl: APP_URL,
  });
}

afterEach(() => {
  clearReassignProviders();
});

describe('listPendingInvitations', () => {
  it('lists only invitations that are not accepted, revoked or expired, oldest first', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const first = await invite(tx, workspaceId, ownerId, 'first@example.test');
      const second = await invite(tx, workspaceId, ownerId, 'second@example.test');
      // Rows written in one transaction share `now()`; spread them so the order is deterministic.
      for (const [issued, at] of [
        [first, '2026-10-01T10:00:00Z'],
        [second, '2026-10-02T10:00:00Z'],
      ] as const) {
        await tx
          .update(schema.invitation)
          .set({ createdAt: new Date(at) })
          .where(eq(schema.invitation.id, issued.invitation.id));
      }
      const revoked = await invite(tx, workspaceId, ownerId, 'revoked@example.test');
      await revokeInvitation(tx, {
        workspaceId,
        actorUserId: ownerId,
        invitationId: revoked.invitation.id,
      });
      const expired = await invite(tx, workspaceId, ownerId, 'expired@example.test');
      await tx
        .update(schema.invitation)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.invitation.id, expired.invitation.id));
      const accepted = await invite(tx, workspaceId, ownerId, 'accepted@example.test');
      await tx
        .update(schema.invitation)
        .set({ acceptedAt: new Date() })
        .where(eq(schema.invitation.id, accepted.invitation.id));

      const pending = await listPendingInvitations(tx, workspaceId);
      expect(pending.map((p) => p.id)).toEqual([first.invitation.id, second.invitation.id]);
      expect(pending[0]).toMatchObject({
        workspaceId,
        email: 'first@example.test',
        role: 'junior',
      });
      expect(pending[0]?.invitedAt).toBeInstanceOf(Date);
    });
  });

  it('never lists another workspace’s invitations, nor any of a soft-deleted workspace', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const otherId = await newWorkspace(tx, ownerId);
      await invite(tx, otherId, ownerId, 'other@example.test');
      expect(await listPendingInvitations(tx, workspaceId)).toEqual([]);

      await softDeleteWorkspace(tx, { workspaceId: otherId, actorUserId: ownerId });
      expect(await listPendingInvitations(tx, otherId)).toEqual([]);
    });
  });
});

describe('countOpenWork', () => {
  it('is 0 without providers and sums every provider’s open items for the user', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const junior = await addMember(tx, workspaceId, 'junior');
      expect(await countOpenWork(tx, workspaceId, junior.userId)).toBe(0);

      const counts = new Map([[junior.userId, 2]]);
      const provider = {
        countOpen: (_tx: unknown, ws: string, userId: string) =>
          Promise.resolve(ws === workspaceId ? (counts.get(userId) ?? 0) : 0),
        reassign: () => Promise.resolve(),
      };
      registerReassignProvider({ name: 'tasks', ...provider });
      registerReassignProvider({ name: 'obligations', ...provider });
      expect(await countOpenWork(tx, workspaceId, junior.userId)).toBe(4);
      expect(await countOpenWork(tx, workspaceId, ownerId)).toBe(0);
    });
  });
});

describe('listMembers lastActiveAt', () => {
  it('is the latest session activity of the user, or null without a session', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspaceId = await newWorkspace(tx, ownerId);
      const junior = await addMember(tx, workspaceId, 'junior');
      const older = new Date('2026-10-01T10:00:00.000Z');
      const newer = new Date('2026-10-05T08:30:00.000Z');
      for (const updatedAt of [older, newer]) {
        await tx.insert(schema.session).values({
          userId: junior.userId,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          updatedAt,
        });
      }

      const members = await listMembers(tx, workspaceId);
      const byUser = new Map(members.map((m) => [m.userId, m]));
      expect(byUser.get(junior.userId)?.lastActiveAt?.toISOString()).toBe(newer.toISOString());
      expect(byUser.get(ownerId)?.lastActiveAt).toBeNull();
    });
  });
});
