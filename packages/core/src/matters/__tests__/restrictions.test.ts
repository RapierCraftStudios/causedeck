// Per-matter restrictions (#233): creating one requires `matter.restrict`, and a restricted matter
// is readable only by its listed users plus owners (configurable); everyone else gets NOT_FOUND.
// Since #345 a restriction needs a real matter of the workspace (composite FK to `matter`).
import { randomUUID } from 'node:crypto';

import type { Role } from '@causedeck/auth';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import {
  assertMatterReadable,
  listMatterRestrictions,
  restrictMatter,
  updateRoleSettings,
  WorkspaceError,
} from '../../index.ts';

type Users = Record<Role | 'listed' | 'outsider', string>;

async function newUser(tx: Transaction, label: string): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: label, email: `${label}-${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

/** A matter of the workspace. */
async function newMatter(tx: Transaction, workspaceId: string): Promise<string> {
  const [row] = await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(schema.matter)
      .values({ workspaceId, title: 'Test v. State' })
      .returning({ id: schema.matter.id }),
  );
  if (!row) throw new Error('matter insert failed');
  return row.id;
}

/** A workspace with one active member per role, an extra advocate (`listed`) and a non-member. */
async function seed(tx: Transaction): Promise<{ workspaceId: string; users: Users }> {
  const workspaceId = randomUUID();
  const users = {} as Users;
  for (const key of ['owner', 'advocate', 'junior', 'clerk', 'viewer', 'listed', 'outsider']) {
    users[key as keyof Users] = await newUser(tx, key);
  }
  await inWorkspace(tx, workspaceId, async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Chambers', slug: `mr-${workspaceId}` });
    await s
      .insert(schema.member)
      .values(
        (['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const)
          .map((role) => ({ organizationId: workspaceId, userId: users[role], role }))
          .concat([
            { organizationId: workspaceId, userId: users.listed, role: 'advocate' as const },
          ]),
      );
  });
  return { workspaceId, users };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (error === undefined) return undefined;
  expect(error).toBeInstanceOf(WorkspaceError);
  return (error as WorkspaceError).code;
}

describe('restrictMatter', () => {
  it('requires matter.restrict: advocates and owners may, juniors, clerks and viewers may not', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      for (const role of ['clerk', 'viewer'] as const) {
        const actor = { userId: users[role], workspaceId };
        expect(
          await codeOf(
            restrictMatter(tx, actor, {
              matterId: await newMatter(tx, workspaceId),
              allowedUserIds: [],
            }),
          ),
        ).toBe('FORBIDDEN');
      }
      // A junior reads only assigned matters: an unassigned one is NOT_FOUND, an assigned one FORBIDDEN.
      const assigned = await newMatter(tx, workspaceId);
      const junior = { userId: users.junior, workspaceId, assignedMatterIds: new Set([assigned]) };
      expect(
        await codeOf(
          restrictMatter(tx, junior, {
            matterId: await newMatter(tx, workspaceId),
            allowedUserIds: [],
          }),
        ),
      ).toBe('NOT_FOUND');
      expect(
        await codeOf(restrictMatter(tx, junior, { matterId: assigned, allowedUserIds: [] })),
      ).toBe('FORBIDDEN');
      for (const role of ['advocate', 'owner'] as const) {
        const matterId = await newMatter(tx, workspaceId);
        const row = await restrictMatter(
          tx,
          { userId: users[role], workspaceId },
          { matterId, allowedUserIds: [users.listed], reason: 'sensitive' },
        );
        expect(row).toMatchObject({
          workspaceId,
          matterId,
          allowedUserIds: [users.listed],
          reason: 'sensitive',
          createdBy: users[role],
        });
      }
    });
  });

  it('is NOT_FOUND for a matter the workspace does not have (#345)', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const other = await seed(tx);
      const otherMatter = await newMatter(tx, other.workspaceId);
      const owner = { userId: users.owner, workspaceId };
      for (const matterId of [randomUUID(), otherMatter]) {
        expect(await codeOf(restrictMatter(tx, owner, { matterId, allowedUserIds: [] }))).toBe(
          'NOT_FOUND',
        );
      }
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.matterRestriction),
      );
      expect(rows).toEqual([]);
    });
  });

  it('takes the role from the membership, not the caller', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const claimsOwner = { userId: users.viewer, workspaceId, role: 'owner' as const };
      expect(
        await codeOf(
          restrictMatter(tx, claimsOwner, {
            matterId: await newMatter(tx, workspaceId),
            allowedUserIds: [],
          }),
        ),
      ).toBe('FORBIDDEN');
      const outsider = { userId: users.outsider, workspaceId, role: 'owner' as const };
      expect(
        await codeOf(
          restrictMatter(tx, outsider, {
            matterId: await newMatter(tx, workspaceId),
            allowedUserIds: [],
          }),
        ),
      ).toBe('NOT_FOUND');
    });
  });

  it('keeps one row per (workspace, matter): restricting again replaces the allow list', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const matterId = await newMatter(tx, workspaceId);
      const owner = { userId: users.owner, workspaceId };
      const first = await restrictMatter(tx, owner, { matterId, allowedUserIds: [users.listed] });
      const second = await restrictMatter(tx, owner, {
        matterId,
        allowedUserIds: [users.advocate],
      });
      expect(second.id).toBe(first.id);
      expect(second.allowedUserIds).toEqual([users.advocate]);
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.select().from(schema.matterRestriction),
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('rejects allowed users who are not active members', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      expect(
        await codeOf(
          restrictMatter(
            tx,
            { userId: users.owner, workspaceId },
            { matterId: await newMatter(tx, workspaceId), allowedUserIds: [users.outsider] },
          ),
        ),
      ).toBe('VALIDATION');
    });
  });

  it('is NOT_FOUND for an advocate not listed on an already restricted matter', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const matterId = await newMatter(tx, workspaceId);
      await restrictMatter(
        tx,
        { userId: users.owner, workspaceId },
        { matterId, allowedUserIds: [users.listed] },
      );
      expect(
        await codeOf(
          restrictMatter(
            tx,
            { userId: users.advocate, workspaceId },
            { matterId, allowedUserIds: [users.advocate] },
          ),
        ),
      ).toBe('NOT_FOUND');
      // The listed advocate may change it.
      const row = await restrictMatter(
        tx,
        { userId: users.listed, workspaceId },
        { matterId, allowedUserIds: [users.listed, users.junior] },
      );
      expect(row.allowedUserIds).toEqual([users.listed, users.junior]);
    });
  });
});

describe('assertMatterReadable', () => {
  it('lets only listed users and owners read a restricted matter; others get NOT_FOUND', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const matterId = await newMatter(tx, workspaceId);
      await restrictMatter(
        tx,
        { userId: users.owner, workspaceId },
        { matterId, allowedUserIds: [users.listed, users.junior] },
      );
      const read = (userId: string, settings?: { ownersSeeRestrictedMatters?: boolean }) =>
        assertMatterReadable(tx, { userId, workspaceId }, matterId, settings);

      expect((await read(users.listed))?.matterId).toBe(matterId);
      expect((await read(users.junior))?.matterId).toBe(matterId);
      // Owners are included by default.
      expect((await read(users.owner))?.matterId).toBe(matterId);
      for (const role of ['advocate', 'clerk', 'viewer', 'outsider'] as const) {
        expect(await codeOf(read(users[role])), role).toBe('NOT_FOUND');
      }
      // Configurable: owners not listed lose access when the setting is off.
      expect(await codeOf(read(users.owner, { ownersSeeRestrictedMatters: false }))).toBe(
        'NOT_FOUND',
      );
      expect((await read(users.listed, { ownersSeeRestrictedMatters: false }))?.matterId).toBe(
        matterId,
      );
    });
  });

  it('returns null for an unrestricted matter any member may read', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      expect(
        await assertMatterReadable(tx, { userId: users.viewer, workspaceId }, randomUUID()),
      ).toBeNull();
    });
  });
});

/** Turn the workspace's stored `owners_see_restricted` off, as its owner. */
async function ownersSeeRestricted(
  tx: Transaction,
  workspaceId: string,
  ownerId: string,
  value: boolean,
): Promise<void> {
  await inWorkspace(tx, workspaceId, (s) =>
    updateRoleSettings(s, {
      workspaceId,
      actorUserId: ownerId,
      input: { advocatesCanInvite: true, ownersSeeRestrictedMatters: value },
    }),
  );
}

describe('stored owners_see_restricted (#285)', () => {
  it('applies when the caller passes no settings; passed settings still win', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const matterId = await newMatter(tx, workspaceId);
      await restrictMatter(
        tx,
        { userId: users.advocate, workspaceId },
        { matterId, allowedUserIds: [users.listed] },
      );
      const owner = { userId: users.owner, workspaceId };
      expect((await assertMatterReadable(tx, owner, matterId))?.matterId).toBe(matterId);

      await ownersSeeRestricted(tx, workspaceId, users.owner, false);
      expect(await codeOf(assertMatterReadable(tx, owner, matterId))).toBe('NOT_FOUND');
      expect(
        (await assertMatterReadable(tx, owner, matterId, { ownersSeeRestrictedMatters: true }))
          ?.matterId,
      ).toBe(matterId);
      // A listed user is unaffected.
      expect(
        (await assertMatterReadable(tx, { userId: users.listed, workspaceId }, matterId))?.matterId,
      ).toBe(matterId);
    });
  });
});

describe('listMatterRestrictions (#285)', () => {
  it('lists what the actor may read, newest first, with allowed members by name', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const first = await newMatter(tx, workspaceId);
      const second = await newMatter(tx, workspaceId);
      const advocate = { userId: users.advocate, workspaceId };
      await restrictMatter(tx, advocate, {
        matterId: first,
        allowedUserIds: [users.listed, users.advocate],
        reason: 'Sealed cover',
      });
      await restrictMatter(tx, advocate, { matterId: second, allowedUserIds: [users.listed] });

      const owner = await listMatterRestrictions(tx, { userId: users.owner, workspaceId });
      expect(owner.map((r) => r.matterId).sort()).toEqual([first, second].sort());
      const sealed = owner.find((r) => r.matterId === first);
      expect(sealed?.reason).toBe('Sealed cover');
      expect(sealed?.allowedUsers.map((u) => u.name).sort()).toEqual(['advocate', 'listed']);

      // Others see only what they are listed on; a clerk sees none of them.
      expect((await listMatterRestrictions(tx, advocate)).map((r) => r.matterId)).toEqual([first]);
      expect((await listMatterRestrictions(tx, { userId: users.listed, workspaceId })).length).toBe(
        2,
      );
      expect(await listMatterRestrictions(tx, { userId: users.clerk, workspaceId })).toEqual([]);

      // With owners_see_restricted off, the owner sees only matters they are listed on: none.
      await ownersSeeRestricted(tx, workspaceId, users.owner, false);
      expect(await listMatterRestrictions(tx, { userId: users.owner, workspaceId })).toEqual([]);
    });
  });

  it('is NOT_FOUND for a non-member', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      expect(
        await codeOf(listMatterRestrictions(tx, { userId: users.outsider, workspaceId })),
      ).toBe('NOT_FOUND');
    });
  });
});
