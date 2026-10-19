// Workspace profile (#284) against a real Postgres: the update needs `workspace.manage`, a slug
// change is owner-only and keeps the old slug redirecting, and both are audited (field names only).
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  createWorkspace,
  getWorkspaceProfile,
  resolveSlug,
  updateWorkspaceProfile,
  WorkspaceError,
  type UpdateWorkspaceProfileRequest,
  type WorkspaceRole,
} from '../index.ts';

const update = (tx: Transaction, request: UpdateWorkspaceProfileRequest) =>
  inWorkspace(tx, request.workspaceId, (s) => updateWorkspaceProfile(s, request));
const profileOf = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => getWorkspaceProfile(s, workspaceId));

async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'Advocate', email: `${randomUUID()}@example.test` })
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
    input: { name: `Profile ${randomUUID().slice(0, 8)}` },
  });
  return { ownerId, workspace };
}

async function audits(tx: Transaction, workspaceId: string, action: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select({
        actorUserId: schema.auditEvent.actorUserId,
        metadata: schema.auditEvent.metadata,
        targetId: schema.auditEvent.targetId,
      })
      .from(schema.auditEvent)
      .where(
        and(eq(schema.auditEvent.workspaceId, workspaceId), eq(schema.auditEvent.action, action)),
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

const input = {
  name: 'Iyer Chambers',
  kind: 'chamber',
  timezone: 'Asia/Kolkata',
  locale: 'ta',
  practiceCity: 'Chennai',
} as const;

describe('workspace profile', () => {
  it('reads defaults for a new workspace', async () => {
    await withTestDb(async (tx) => {
      const { workspace } = await setup(tx);
      expect(await profileOf(tx, workspace.id)).toEqual({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        kind: 'solo',
        timezone: 'Asia/Kolkata',
        locale: 'en',
        practiceCity: null,
      });
    });
  });

  it('saves every field and audits the changed field names only', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspace } = await setup(tx);
      const advocateId = await addMember(tx, workspace.id, 'advocate');
      const result = await update(tx, {
        workspaceId: workspace.id,
        actorUserId: advocateId,
        input,
      });
      expect(result.changed).toEqual(['name', 'kind', 'locale', 'practiceCity']);
      expect(result.renamed).toBeNull();
      expect(await profileOf(tx, workspace.id)).toMatchObject({ ...input, slug: workspace.slug });

      const rows = await audits(tx, workspace.id, 'workspace.profile_updated');
      expect(rows).toEqual([
        {
          actorUserId: advocateId,
          targetId: workspace.id,
          metadata: { fields: 'name,kind,locale,practiceCity' },
        },
      ]);
      expect(JSON.stringify(rows)).not.toContain('Chennai');

      // An unchanged save writes no event.
      await update(tx, { workspaceId: workspace.id, actorUserId: ownerId, input });
      expect(await audits(tx, workspace.id, 'workspace.profile_updated')).toHaveLength(1);
    });
  });

  it('clears the practice city with an empty value', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspace } = await setup(tx);
      await update(tx, { workspaceId: workspace.id, actorUserId: ownerId, input });
      await update(tx, {
        workspaceId: workspace.id,
        actorUserId: ownerId,
        input: { ...input, practiceCity: '' },
      });
      expect((await profileOf(tx, workspace.id))?.practiceCity).toBeNull();
    });
  });

  it('refuses juniors, clerks and viewers, and invalid input', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspace } = await setup(tx);
      for (const role of ['junior', 'clerk', 'viewer'] as const) {
        const userId = await addMember(tx, workspace.id, role);
        await expectCode(
          update(tx, { workspaceId: workspace.id, actorUserId: userId, input }),
          'FORBIDDEN',
        );
      }
      await expectCode(
        update(tx, {
          workspaceId: workspace.id,
          actorUserId: ownerId,
          input: { ...input, timezone: 'Mars/Olympus' },
        }),
        'VALIDATION',
      );
      expect(await profileOf(tx, workspace.id)).toMatchObject({ name: workspace.name });
    });
  });

  it('lets only the owner rename the slug, keeps a redirect and audits the rename', async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspace } = await setup(tx);
      const advocateId = await addMember(tx, workspace.id, 'advocate');
      const newSlug = `renamed-${randomUUID().slice(0, 8)}`;

      await expectCode(
        update(tx, {
          workspaceId: workspace.id,
          actorUserId: advocateId,
          input: { ...input, slug: newSlug },
        }),
        'FORBIDDEN',
      );
      // The refused rename rolled back the profile change made in the same call.
      expect(await profileOf(tx, workspace.id)).toMatchObject({
        name: workspace.name,
        slug: workspace.slug,
      });

      const result = await update(tx, {
        workspaceId: workspace.id,
        actorUserId: ownerId,
        input: { ...input, slug: newSlug },
      });
      expect(result.renamed).toEqual({ from: workspace.slug, to: newSlug });
      expect(result.profile.slug).toBe(newSlug);
      expect(await resolveSlug(tx, workspace.slug)).toMatchObject({
        workspace: { id: workspace.id, slug: newSlug },
        redirectFrom: workspace.slug,
      });
      expect(await audits(tx, workspace.id, 'workspace.slug_renamed')).toEqual([
        {
          actorUserId: ownerId,
          targetId: workspace.id,
          metadata: { from: workspace.slug, to: newSlug },
        },
      ]);
    });
  });
});
