// Isolation as the app role (#19): rows of a tenant table are visible only inside their own
// workspace's scope, never with no scope, and the user-only scope shows a user just their own
// memberships and workspaces.
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { withUser } from '../../rls.ts';
import { member, organization } from '../../schema/auth.ts';
import { jobEffect } from '../../schema/job-effect.ts';
import { workspaceSettings } from '../../schema/workspace.ts';
import { inWorkspace, withTestDb } from '../../testing/index.ts';
import { newWorkspace } from './fixtures.ts';

describe('FORCE row-level security as causedeck_app', () => {
  it('select * from member returns only the scoped workspace, and nothing with no GUC', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx, 2);
      const b = await newWorkspace(tx, 3);

      const inA = await inWorkspace(tx, a.id, (s) => s.select().from(member));
      expect(inA).toHaveLength(2);
      expect(new Set(inA.map((m) => m.organizationId))).toEqual(new Set([a.id]));

      const inB = await inWorkspace(tx, b.id, (s) => s.select().from(member));
      expect(inB).toHaveLength(3);
      expect(new Set(inB.map((m) => m.organizationId))).toEqual(new Set([b.id]));

      expect(await tx.select().from(member)).toEqual([]);
      expect(await tx.select().from(organization)).toEqual([]);
    });
  });

  it('applies to every baseline tenant table, not only member', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      for (const ws of [a, b]) {
        await inWorkspace(tx, ws.id, async (s) => {
          await s.insert(workspaceSettings).values({ workspaceId: ws.id });
          await s
            .insert(jobEffect)
            .values({ jobName: 'test.rls', idempotencyKey: 'k', workspaceId: ws.id });
        });
      }
      const seen = await inWorkspace(tx, a.id, async (s) => ({
        settings: await s.select().from(workspaceSettings),
        effects: await s.select().from(jobEffect),
        orgs: await s.select({ id: organization.id }).from(organization),
      }));
      expect(seen.settings.map((r) => r.workspaceId)).toEqual([a.id]);
      expect(seen.effects.map((r) => r.workspaceId)).toEqual([a.id]);
      expect(seen.orgs).toEqual([{ id: a.id }]);
      expect(await tx.select().from(jobEffect).where(eq(jobEffect.workspaceId, b.id))).toEqual([]);
    });
  });

  it('withUser shows only the user’s own memberships and their workspaces', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx, 2);
      const b = await newWorkspace(tx, 1);
      const [alice, colleague] = a.userIds as [string, string];
      const seen = await withUser(tx, { userId: alice }, async (s) => ({
        members: await s.select().from(member),
        orgs: await s.select({ id: organization.id }).from(organization),
      }));
      expect(seen.members.map((m) => m.userId)).toEqual([alice]);
      expect(seen.members.map((m) => m.userId)).not.toContain(colleague);
      expect(seen.orgs).toEqual([{ id: a.id }]);
      expect(seen.orgs).not.toContainEqual({ id: b.id });
    });
  });

  it('a user scope inside a workspace does not widen it (member_self needs no workspace)', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const [user] = b.userIds as [string];
      // The B member's user id pinned while scoped to A: still only A's rows.
      const rows = await inWorkspace(tx, a.id, (s) => s.select().from(member), user);
      expect(rows.map((m) => m.organizationId)).toEqual([a.id]);
    });
  });
});
