// Workspace domain service against a real Postgres (Testcontainers, #177). Every test runs in a
// rolled-back transaction; the service's own transactions become savepoints inside it.
import { randomUUID } from 'node:crypto';

import { schema, withUser, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { RESERVED_SLUGS } from '@causedeck/validators/workspace';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import * as core from '../index.ts';
import {
  createWorkspace,
  entitlements,
  listMemberships,
  listWorkspacesForUser,
  memberRole,
  resolveSlug,
  setEntitlements,
  WorkspaceError,
  type WorkspaceRole,
} from '../index.ts';

// Workspace-scoped operations run inside the workspace's scope, as the app calls them (members
// actions get `ctx.tx` from `withWorkspace`); FORCE row-level security (#19) hides everything else.
function scoped<R extends { workspaceId: string }, T>(
  fn: (db: Transaction, request: R) => Promise<T>,
): (tx: Transaction, request: R) => Promise<T> {
  return (tx, request) => inWorkspace(tx, request.workspaceId, (s) => fn(s, request));
}
const changeRole = scoped(core.changeRole);
const removeMember = scoped(core.removeMember);
const prepareOwnershipTransfer = scoped(core.prepareOwnershipTransfer);
const transferOwnership = scoped(core.transferOwnership);
const renameSlug = scoped(core.renameSlug);
const softDeleteWorkspace = scoped(core.softDeleteWorkspace);
const listMembers = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => core.listMembers(s, workspaceId));
const countBillableSeats = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, (s) => core.countBillableSeats(s, workspaceId));

async function newUser(tx: Transaction, name = 'Advocate'): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name, email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

async function addMember(
  tx: Transaction,
  workspaceId: string,
  role: WorkspaceRole,
  status: 'active' | 'suspended' | 'removed' = 'active',
): Promise<{ userId: string; memberId: string }> {
  const userId = await newUser(tx, role);
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId, role, status })
      .returning({ id: schema.member.id }),
  );
  if (!row) throw new Error('member insert failed');
  return { userId, memberId: row.id };
}

async function memberIdOf(tx: Transaction, workspaceId: string, userId: string): Promise<string> {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, userId))),
  );
  if (!row) throw new Error('member not found');
  return row.id;
}

/** A unique name so slug assertions do not depend on other test files' rows. */
function uniqueName(prefix = 'Chambers'): string {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

async function expectCode(promise: Promise<unknown>, code: WorkspaceError['code']): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(WorkspaceError);
  expect((error as WorkspaceError).code).toBe(code);
}

describe('createWorkspace', () => {
  it('requires a name', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      await expectCode(createWorkspace(tx, { userId, input: { name: '  ' } }), 'VALIDATION');
      await expectCode(
        createWorkspace(tx, { userId, input: {} as { name: string } }),
        'VALIDATION',
      );
    });
  });

  it('makes the creator owner and writes organization, member and settings rows', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const name = uniqueName('Iyer & Associates — Chennai');
      const workspace = await createWorkspace(tx, { userId, input: { name, kind: 'chamber' } });

      expect(workspace).toMatchObject({
        name,
        kind: 'chamber',
        createdBy: userId,
        deletedAt: null,
      });
      expect(workspace.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(workspace.slug.startsWith('iyer-associates-chennai-')).toBe(true);
      expect(await memberRole(tx, userId, workspace.id)).toBe('owner');
      const [settings] = await inWorkspace(tx, workspace.id, (s) =>
        s
          .select()
          .from(schema.workspaceSettings)
          .where(eq(schema.workspaceSettings.workspaceId, workspace.id)),
      );
      expect(settings).toMatchObject({ indiaOnlyAi: true, timezone: 'Asia/Kolkata', locale: 'en' });
    });
  });

  it('suffixes a colliding slug', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const name = uniqueName();
      const first = await createWorkspace(tx, { userId, input: { name } });
      const second = await createWorkspace(tx, { userId, input: { name } });
      const third = await createWorkspace(tx, { userId, input: { name } });
      expect(second.slug).toBe(`${first.slug}-2`);
      expect(third.slug).toBe(`${first.slug}-3`);
    });
  });

  it.each(RESERVED_SLUGS)('never generates the reserved slug %j', async (reserved) => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const workspace = await createWorkspace(tx, { userId, input: { name: reserved } });
      expect(RESERVED_SLUGS as readonly string[]).not.toContain(workspace.slug);
    });
  });

  it('is atomic: a failing settings insert leaves no workspace or membership', async () => {
    await withTestDb(async (tx) => {
      const userId = await newUser(tx);
      const name = uniqueName('Atomic');
      // Fail the third insert (workspace_settings) inside createWorkspace's transaction.
      const failingDb = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop !== 'transaction') return Reflect.get(target, prop, receiver) as unknown;
          return (fn: (inner: Transaction) => Promise<unknown>) =>
            target.transaction((inner) =>
              fn(
                new Proxy(inner, {
                  get(t, p, r) {
                    if (p !== 'insert') return Reflect.get(t, p, r) as unknown;
                    return (table: unknown) => {
                      if (table === schema.workspaceSettings) throw new Error('settings failed');
                      return t.insert(table as typeof schema.member);
                    };
                  },
                }),
              ),
            );
        },
      });
      await expect(createWorkspace(failingDb, { userId, input: { name } })).rejects.toThrow(
        'settings failed',
      );
      // As the creator: a surviving membership would make its workspace visible too (#19).
      const left = await withUser(tx, { userId }, async (s) => ({
        workspaces: await s
          .select()
          .from(schema.organization)
          .where(eq(schema.organization.name, name)),
        members: await s.select().from(schema.member).where(eq(schema.member.userId, userId)),
      }));
      expect(left).toEqual({ workspaces: [], members: [] });
    });
  });
});

describe('roles and removal', () => {
  it('only owners change roles or remove members', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      const advocate = await addMember(tx, workspace.id, 'advocate');
      const junior = await addMember(tx, workspace.id, 'junior');

      await expectCode(
        changeRole(tx, {
          workspaceId: workspace.id,
          actorUserId: advocate.userId,
          memberId: junior.memberId,
          role: 'viewer',
        }),
        'FORBIDDEN',
      );
      await expectCode(
        removeMember(tx, {
          workspaceId: workspace.id,
          actorUserId: advocate.userId,
          memberId: junior.memberId,
        }),
        'FORBIDDEN',
      );

      await changeRole(tx, {
        workspaceId: workspace.id,
        actorUserId: ownerId,
        memberId: junior.memberId,
        role: 'viewer',
      });
      expect(await memberRole(tx, junior.userId, workspace.id)).toBe('viewer');
      await removeMember(tx, {
        workspaceId: workspace.id,
        actorUserId: ownerId,
        memberId: junior.memberId,
      });
      expect(await memberRole(tx, junior.userId, workspace.id)).toBeNull();
      // Rows created in one transaction share joined_at, so compare without order.
      expect((await listMembers(tx, workspace.id)).map((m) => m.userId).sort()).toEqual(
        [ownerId, advocate.userId].sort(),
      );
    });
  });

  it('refuses to demote or remove the last owner with CONFLICT', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      const ownerMemberId = await memberIdOf(tx, workspace.id, ownerId);
      const request = { workspaceId: workspace.id, actorUserId: ownerId, memberId: ownerMemberId };

      await expectCode(changeRole(tx, { ...request, role: 'advocate' }), 'CONFLICT');
      await expectCode(removeMember(tx, request), 'CONFLICT');
      expect(await memberRole(tx, ownerId, workspace.id)).toBe('owner');

      // With a second owner, the first may step down.
      await addMember(tx, workspace.id, 'owner');
      await changeRole(tx, { ...request, role: 'advocate' });
      expect(await memberRole(tx, ownerId, workspace.id)).toBe('advocate');
    });
  });
});

describe('ownership transfer', () => {
  it('needs the two-step confirmation and then swaps owner and advocate', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      const junior = await addMember(tx, workspace.id, 'junior');
      const request = {
        workspaceId: workspace.id,
        actorUserId: ownerId,
        newOwnerUserId: junior.userId,
      };

      await expectCode(
        prepareOwnershipTransfer(tx, { ...request, actorUserId: junior.userId }),
        'FORBIDDEN',
      );
      const plan = await prepareOwnershipTransfer(tx, request);
      expect(plan).toMatchObject({
        confirmation: workspace.slug,
        newOwner: { userId: junior.userId, role: 'junior' },
      });

      await expectCode(
        transferOwnership(tx, { ...request, confirmation: undefined }),
        'VALIDATION',
      );
      await expectCode(transferOwnership(tx, { ...request, confirmation: 'nope' }), 'VALIDATION');
      expect(await memberRole(tx, ownerId, workspace.id)).toBe('owner');

      await transferOwnership(tx, { ...request, confirmation: plan.confirmation });
      expect(await memberRole(tx, junior.userId, workspace.id)).toBe('owner');
      expect(await memberRole(tx, ownerId, workspace.id)).toBe('advocate');
    });
  });
});

describe('seats', () => {
  afterEach(() => {
    setEntitlements(null);
  });

  it('counts active members by role and distinguishes clerks', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      await addMember(tx, workspace.id, 'advocate');
      await addMember(tx, workspace.id, 'clerk');
      await addMember(tx, workspace.id, 'clerk');
      await addMember(tx, workspace.id, 'junior', 'suspended');
      await addMember(tx, workspace.id, 'viewer', 'removed');

      expect(await countBillableSeats(tx, workspace.id)).toEqual({
        total: 4,
        byRole: { owner: 1, advocate: 1, junior: 0, clerk: 2, viewer: 0 },
        clerk: 2,
        nonClerk: 2,
      });
    });
  });

  it('gates seats through a permissive-by-default entitlements seam', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      await expect(entitlements.assertCanAddSeat(tx, workspace.id, 'advocate')).resolves.toBe(
        undefined,
      );

      setEntitlements({
        assertCanAddSeat: () => Promise.reject(new WorkspaceError('CONFLICT', 'No seats left')),
      });
      await expectCode(entitlements.assertCanAddSeat(tx, workspace.id, 'advocate'), 'CONFLICT');
    });
  });
});

describe('slug rename and redirect', () => {
  it('lets only an owner rename, to a valid, unreserved, free slug', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      const other = await createWorkspace(tx, { userId: ownerId, input: { name: uniqueName() } });
      const advocate = await addMember(tx, workspace.id, 'advocate');
      const request = { workspaceId: workspace.id, actorUserId: ownerId };

      await expectCode(
        renameSlug(tx, { ...request, actorUserId: advocate.userId, newSlug: `x-${randomUUID()}` }),
        'FORBIDDEN',
      );
      for (const reserved of RESERVED_SLUGS) {
        await expectCode(renameSlug(tx, { ...request, newSlug: reserved }), 'VALIDATION');
      }
      await expectCode(renameSlug(tx, { ...request, newSlug: 'Not A Slug' }), 'VALIDATION');
      await expectCode(renameSlug(tx, { ...request, newSlug: other.slug }), 'CONFLICT');
    });
  });

  it('redirects the old slug for 90 days and keeps it from other workspaces until then', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      const other = await createWorkspace(tx, { userId: ownerId, input: { name: uniqueName() } });
      const oldSlug = workspace.slug;
      const newSlug = `renamed-${randomUUID().slice(0, 8)}`;

      expect(
        await renameSlug(tx, { workspaceId: workspace.id, actorUserId: ownerId, newSlug }),
      ).toBe(newSlug);
      expect(await resolveSlug(tx, newSlug)).toMatchObject({
        workspace: { id: workspace.id, slug: newSlug },
        redirectFrom: null,
      });
      expect(await resolveSlug(tx, oldSlug)).toMatchObject({
        workspace: { id: workspace.id, slug: newSlug },
        redirectFrom: oldSlug,
      });
      // Slugs are case-insensitive (citext).
      expect((await resolveSlug(tx, oldSlug.toUpperCase()))?.workspace.id).toBe(workspace.id);

      const [history] = await inWorkspace(tx, workspace.id, (s) =>
        s
          .select()
          .from(schema.workspaceSlugHistory)
          .where(eq(schema.workspaceSlugHistory.slug, oldSlug)),
      );
      expect(history).toBeDefined();
      const days = history
        ? (history.expiresAt.getTime() - history.createdAt.getTime()) / 86_400_000
        : 0;
      expect(Math.round(days)).toBe(90);

      await expectCode(
        renameSlug(tx, { workspaceId: other.id, actorUserId: ownerId, newSlug: oldSlug }),
        'CONFLICT',
      );

      // After the window the redirect is gone and the slug is free again.
      await inWorkspace(tx, workspace.id, (s) =>
        s
          .update(schema.workspaceSlugHistory)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(schema.workspaceSlugHistory.slug, oldSlug)),
      );
      expect(await resolveSlug(tx, oldSlug)).toBeNull();
      await renameSlug(tx, { workspaceId: other.id, actorUserId: ownerId, newSlug: oldSlug });
      expect((await resolveSlug(tx, oldSlug))?.workspace.id).toBe(other.id);
    });
  });

  it('lets a workspace rename back to its own previous slug', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const workspace = await createWorkspace(tx, {
        userId: ownerId,
        input: { name: uniqueName() },
      });
      const request = { workspaceId: workspace.id, actorUserId: ownerId };
      await renameSlug(tx, { ...request, newSlug: `tmp-${randomUUID().slice(0, 8)}` });
      await renameSlug(tx, { ...request, newSlug: workspace.slug });
      expect(await resolveSlug(tx, workspace.slug)).toMatchObject({ redirectFrom: null });
    });
  });
});

describe('soft delete and member status', () => {
  it('hides a soft-deleted workspace from membership queries and slug resolution', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const kept = await createWorkspace(tx, { userId: ownerId, input: { name: uniqueName() } });
      const deleted = await createWorkspace(tx, { userId: ownerId, input: { name: uniqueName() } });
      const advocate = await addMember(tx, deleted.id, 'advocate');

      await expectCode(
        softDeleteWorkspace(tx, { workspaceId: deleted.id, actorUserId: advocate.userId }),
        'FORBIDDEN',
      );
      await softDeleteWorkspace(tx, { workspaceId: deleted.id, actorUserId: ownerId });

      expect((await listMemberships(tx, ownerId)).map((m) => m.workspaceId)).toEqual([kept.id]);
      const page = await listWorkspacesForUser(tx, ownerId, { limit: 10 });
      expect(page.data.map((w) => w.id)).toEqual([kept.id]);
      expect(await memberRole(tx, ownerId, deleted.id)).toBeNull();
      expect(await memberRole(tx, advocate.userId, deleted.id)).toBeNull();
      expect(await resolveSlug(tx, deleted.slug)).toBeNull();
      expect(await listMembers(tx, deleted.id)).toEqual([]);
      await expectCode(
        renameSlug(tx, { workspaceId: deleted.id, actorUserId: ownerId, newSlug: 'gone-ws' }),
        'NOT_FOUND',
      );
    });
  });

  it('excludes suspended and removed memberships from membership queries', async () => {
    await withTestDb(async (tx) => {
      const ownerId = await newUser(tx);
      const a = await createWorkspace(tx, { userId: ownerId, input: { name: uniqueName() } });
      const b = await createWorkspace(tx, { userId: ownerId, input: { name: uniqueName() } });
      const userId = await newUser(tx);
      await inWorkspace(tx, a.id, (s) =>
        s
          .insert(schema.member)
          .values({ organizationId: a.id, userId, role: 'junior', status: 'suspended' }),
      );
      await inWorkspace(tx, b.id, (s) =>
        s
          .insert(schema.member)
          .values({ organizationId: b.id, userId, role: 'junior', status: 'removed' }),
      );

      expect(await listMemberships(tx, userId)).toEqual([]);
      expect((await listWorkspacesForUser(tx, userId, { limit: 10 })).data).toEqual([]);
      expect(await memberRole(tx, userId, a.id)).toBeNull();
    });
  });
});
