// Privacy settings (#286) against a real Postgres: India-only AI is on and never written, the
// sensitive-matter default is on and raw audio is kept 30 days by default, members with
// `workspace.manage` (owners and advocates) change the last two, and every change is audited
// (fail-closed) with the changed settings and their new values.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createWorkspace,
  DEFAULT_PRIVACY_SETTINGS,
  getPrivacySettings,
  updateWorkspacePrivacy,
  WorkspaceError,
  type UpdateWorkspacePrivacyRequest,
  type WorkspaceRole,
} from '../index.ts';

const update = (tx: Transaction, request: UpdateWorkspacePrivacyRequest) =>
  inWorkspace(tx, request.workspaceId, (s) => updateWorkspacePrivacy(s, request));
const settingsOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => getPrivacySettings(s, workspaceId));

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
    input: { name: `Privacy ${randomUUID().slice(0, 8)}` },
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
          eq(schema.auditEvent.action, 'workspace.privacy_updated'),
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

const CHANGED = { sensitiveDefaultRestricted: false, retentionAudioDays: 7 } as const;

describe('privacy settings', () => {
  it('defaults to India-only AI on, sensitive matters restricted and 30 days of raw audio', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      expect(await settingsOf(tx, workspaceId)).toEqual(DEFAULT_PRIVACY_SETTINGS);
      expect(DEFAULT_PRIVACY_SETTINGS).toEqual({
        indiaOnlyAi: true,
        sensitiveDefaultRestricted: true,
        retentionAudioDays: 30,
      });
    });
  });

  it('lets an owner change them and audits the changed settings with their new values', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      const result = await update(tx, { workspaceId, actorUserId: ownerId, input: CHANGED });
      expect(result).toEqual({
        settings: { indiaOnlyAi: true, ...CHANGED },
        changed: ['sensitiveDefaultRestricted', 'retentionAudioDays'],
      });
      expect(await settingsOf(tx, workspaceId)).toEqual({ indiaOnlyAi: true, ...CHANGED });
      expect(await audits(tx, workspaceId)).toEqual([
        {
          actorUserId: ownerId,
          targetId: workspaceId,
          metadata: {
            fields: 'sensitiveDefaultRestricted,retentionAudioDays',
            sensitiveDefaultRestricted: 'false',
            retentionAudioDays: '7',
          },
        },
      ]);

      // Saving the same values again changes nothing and records nothing.
      expect(
        (await update(tx, { workspaceId, actorUserId: ownerId, input: CHANGED })).changed,
      ).toEqual([]);
      expect(await audits(tx, workspaceId)).toHaveLength(1);
    });
  });

  it('lets an advocate change them', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const advocateId = await addMember(tx, workspaceId, 'advocate');
      const input = { sensitiveDefaultRestricted: true, retentionAudioDays: 14 } as const;
      expect((await update(tx, { workspaceId, actorUserId: advocateId, input })).changed).toEqual([
        'retentionAudioDays',
      ]);
      expect((await settingsOf(tx, workspaceId)).retentionAudioDays).toBe(14);
    });
  });

  it('is FORBIDDEN for roles without workspace.manage and changes nothing', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      for (const role of ['junior', 'clerk', 'viewer'] as const) {
        const userId = await addMember(tx, workspaceId, role);
        await expectCode(
          update(tx, { workspaceId, actorUserId: userId, input: CHANGED }),
          'FORBIDDEN',
        );
      }
      expect(await settingsOf(tx, workspaceId)).toEqual(DEFAULT_PRIVACY_SETTINGS);
      expect(await audits(tx, workspaceId)).toEqual([]);
    });
  });

  it('rejects India-only AI and windows outside 7, 14 and 30 days', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await setup(tx);
      for (const input of [
        { ...CHANGED, indiaOnlyAi: false },
        { sensitiveDefaultRestricted: true, retentionAudioDays: 90 },
      ]) {
        await expectCode(
          update(tx, {
            workspaceId,
            actorUserId: ownerId,
            input: input as unknown as typeof CHANGED,
          }),
          'VALIDATION',
        );
      }
      expect(await settingsOf(tx, workspaceId)).toEqual(DEFAULT_PRIVACY_SETTINGS);
    });
  });

  it('refuses a raw audio window outside the offered choices in the database too', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId } = await setup(tx);
      const error: unknown = await inWorkspace(tx, workspaceId, (s) =>
        s.transaction((sp) =>
          sp
            .update(schema.workspaceSettings)
            .set({ retentionAudioDays: 365 })
            .where(eq(schema.workspaceSettings.workspaceId, workspaceId)),
        ),
      ).then(
        () => null,
        (e: unknown) => e,
      );
      expect(String((error as { cause?: unknown }).cause ?? error)).toContain(
        'workspace_settings_retention_audio_days_chk',
      );
    });
  });
});
