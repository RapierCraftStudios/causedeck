// Integration tokens (#287) against a real Postgres: a workspace starts with none, members with
// `workspace.manage` create and rotate them, only the sha256 of the token is stored, rotating
// replaces the hash (so the old token no longer resolves), and every rotation is audited
// fail-closed with the kind only.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createWorkspace,
  getIntegrations,
  hashIntegrationToken,
  rotateIntegrationToken,
  WorkspaceError,
  type IntegrationKind,
  type RotateIntegrationTokenRequest,
  type WorkspaceRole,
} from '../index.ts';

const rotate = (tx: Transaction, request: RotateIntegrationTokenRequest) =>
  inWorkspace(tx, request.workspaceId, (s) => rotateIntegrationToken(s, request));
const statusesOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => getIntegrations(s, workspaceId));

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
  await inWorkspace(tx, workspaceId, (s) =>
    s.insert(schema.member).values({ organizationId: workspaceId, userId, role }),
  );
  return userId;
}

async function setup(tx: Transaction) {
  const ownerId = await newUser(tx);
  const workspace = await createWorkspace(tx, {
    userId: ownerId,
    input: { name: `Integrations ${randomUUID().slice(0, 8)}` },
  });
  return { ownerId, workspaceId: workspace.id };
}

/** The stored hashes of one kind (there is at most one). */
async function hashesOf(tx: Transaction, workspaceId: string, kind: IntegrationKind) {
  const rows = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ tokenHash: schema.workspaceIntegration.tokenHash })
      .from(schema.workspaceIntegration)
      .where(
        and(
          eq(schema.workspaceIntegration.workspaceId, workspaceId),
          eq(schema.workspaceIntegration.kind, kind),
        ),
      ),
  );
  return rows.map((r) => r.tokenHash);
}

async function audits(tx: Transaction, workspaceId: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select({
        actorUserId: schema.auditEvent.actorUserId,
        metadata: schema.auditEvent.metadata,
        targetId: schema.auditEvent.targetId,
      })
      .from(schema.auditEvent)
      .where(
        and(
          eq(schema.auditEvent.workspaceId, workspaceId),
          eq(schema.auditEvent.action, 'workspace.integration_token_rotated'),
        ),
      ),
  );
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error: unknown = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  expect((error as WorkspaceError).code).toBe(code);
}

describe('integration tokens', () => {
  it('starts with no token of either kind', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      expect(await statusesOf(tx, workspaceId)).toEqual({ email_intake: null, ics_feed: null });
    });
  });

  it('creates a token, stores only its hash and audits the kind only', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const result = await rotate(tx, { workspaceId, actorUserId: ownerId, kind: 'email_intake' });
      expect(result.kind).toBe('email_intake');
      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(result.rotatedAt).toBeNull();

      expect(await hashesOf(tx, workspaceId, 'email_intake')).toEqual([
        hashIntegrationToken(result.token),
      ]);
      const statuses = await statusesOf(tx, workspaceId);
      expect(statuses.ics_feed).toBeNull();
      expect(statuses.email_intake).toEqual({ createdAt: result.createdAt, rotatedAt: null });
      expect(JSON.stringify(statuses)).not.toContain(hashIntegrationToken(result.token));

      const events = await audits(tx, workspaceId);
      expect(events).toEqual([
        { actorUserId: ownerId, targetId: workspaceId, metadata: { kind: 'email_intake' } },
      ]);
      expect(JSON.stringify(events)).not.toContain(result.token);
    });
  });

  it('rotating replaces the hash, so the old token no longer resolves', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const first = await rotate(tx, { workspaceId, actorUserId: ownerId, kind: 'ics_feed' });
      const second = await rotate(tx, { workspaceId, actorUserId: ownerId, kind: 'ics_feed' });
      expect(second.token).not.toBe(first.token);
      expect(second.createdAt).toEqual(first.createdAt);
      expect(second.rotatedAt).toBeInstanceOf(Date);

      const hashes = await hashesOf(tx, workspaceId, 'ics_feed');
      expect(hashes).toEqual([hashIntegrationToken(second.token)]);
      expect(hashes).not.toContain(hashIntegrationToken(first.token));
      expect((await statusesOf(tx, workspaceId)).ics_feed?.rotatedAt).toEqual(second.rotatedAt);
      expect(await audits(tx, workspaceId)).toHaveLength(2);
    });
  });

  it('lets an advocate rotate', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const advocateId = await addMember(tx, workspaceId, 'advocate');
      await rotate(tx, { workspaceId, actorUserId: advocateId, kind: 'ics_feed' });
      expect((await statusesOf(tx, workspaceId)).ics_feed).not.toBeNull();
    });
  });

  it('is FORBIDDEN for roles without workspace.manage and changes nothing', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const first = await rotate(tx, { workspaceId, actorUserId: ownerId, kind: 'ics_feed' });
      for (const role of ['junior', 'clerk', 'viewer'] as const) {
        const userId = await addMember(tx, workspaceId, role);
        await expectCode(
          rotate(tx, { workspaceId, actorUserId: userId, kind: 'ics_feed' }),
          'FORBIDDEN',
        );
      }
      expect(await hashesOf(tx, workspaceId, 'ics_feed')).toEqual([
        hashIntegrationToken(first.token),
      ]);
      expect(await audits(tx, workspaceId)).toHaveLength(1);
    });
  });

  it('rejects an unknown kind', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      await expectCode(
        rotate(tx, { workspaceId, actorUserId: ownerId, kind: 'webhook' as IntegrationKind }),
        'VALIDATION',
      );
      expect(await audits(tx, workspaceId)).toEqual([]);
    });
  });
});
