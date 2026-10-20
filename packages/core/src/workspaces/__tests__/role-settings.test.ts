// Role settings (#285) against a real Postgres: both default on, only owners (`member.role`) change
// them, and every change is audited (fail-closed) with the changed settings and their new values.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createWorkspace,
  DEFAULT_ROLE_SETTINGS,
  getRoleSettings,
  toPolicySettings,
  updateRoleSettings,
  WorkspaceError,
  type UpdateRoleSettingsRequest,
  type WorkspaceRole,
} from '../index.ts';

const update = (tx: Transaction, request: UpdateRoleSettingsRequest) =>
  inWorkspace(tx, request.workspaceId, (s) => updateRoleSettings(s, request));
const settingsOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => getRoleSettings(s, workspaceId));

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
    input: { name: `Roles ${randomUUID().slice(0, 8)}` },
  });
  return { ownerId, workspaceId: workspace.id };
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
          eq(schema.auditEvent.action, 'workspace.role_settings_updated'),
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

const OFF = { advocatesCanInvite: false, ownersSeeRestrictedMatters: true } as const;

describe('role settings', () => {
  it('defaults both settings on for a new workspace', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      expect(await settingsOf(tx, workspaceId)).toEqual(DEFAULT_ROLE_SETTINGS);
      expect(DEFAULT_ROLE_SETTINGS).toEqual({
        advocatesCanInvite: true,
        ownersSeeRestrictedMatters: true,
      });
    });
  });

  it('lets an owner change them and audits the changed settings with their new values', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const result = await update(tx, { workspaceId, actorUserId: ownerId, input: OFF });
      expect(result).toEqual({ settings: OFF, changed: ['advocatesCanInvite'] });
      expect(await settingsOf(tx, workspaceId)).toEqual(OFF);
      expect(await audits(tx, workspaceId)).toEqual([
        {
          actorUserId: ownerId,
          targetId: workspaceId,
          metadata: { fields: 'advocatesCanInvite', advocatesCanInvite: 'false' },
        },
      ]);

      // Saving the same values again changes nothing and records nothing.
      expect((await update(tx, { workspaceId, actorUserId: ownerId, input: OFF })).changed).toEqual(
        [],
      );
      expect(await audits(tx, workspaceId)).toHaveLength(1);

      const [row] = await inWorkspace(tx, workspaceId, (s) =>
        s
          .select()
          .from(schema.workspaceSettings)
          .where(eq(schema.workspaceSettings.workspaceId, workspaceId)),
      );
      expect(row).toMatchObject({ advocatesCanInvite: false, ownersSeeRestricted: true });
    });
  });

  it('is FORBIDDEN for every role below owner and changes nothing', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      for (const role of ['advocate', 'junior', 'clerk', 'viewer'] as const) {
        const userId = await addMember(tx, workspaceId, role);
        await expectCode(update(tx, { workspaceId, actorUserId: userId, input: OFF }), 'FORBIDDEN');
      }
      expect(await settingsOf(tx, workspaceId)).toEqual(DEFAULT_ROLE_SETTINGS);
      expect(await audits(tx, workspaceId)).toEqual([]);
    });
  });

  it('rejects invalid input', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      await expectCode(
        update(tx, {
          workspaceId,
          actorUserId: ownerId,
          input: { advocatesCanInvite: 'no' } as unknown as typeof OFF,
        }),
        'VALIDATION',
      );
    });
  });

  it('maps to the policy settings can() reads', () => {
    expect(toPolicySettings(OFF)).toEqual({
      advocatesCanInvite: false,
      ownersSeeRestrictedMatters: true,
    });
  });
});
