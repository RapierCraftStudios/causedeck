// Per-matter restrictions (#233): creating one requires `matter.restrict`, and a restricted matter
// is readable only by its listed users plus owners (configurable); everyone else gets NOT_FOUND.
import { randomUUID } from 'node:crypto';

import type { Role } from '@causedeck/auth';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { assertMatterReadable, restrictMatter, WorkspaceError } from '../../index.ts';

type Users = Record<Role | 'listed' | 'outsider', string>;

async function newUser(tx: Transaction, label: string): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: label, email: `${label}-${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
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
          await codeOf(restrictMatter(tx, actor, { matterId: randomUUID(), allowedUserIds: [] })),
        ).toBe('FORBIDDEN');
      }
      // A junior reads only assigned matters: an unassigned one is NOT_FOUND, an assigned one FORBIDDEN.
      const assigned = randomUUID();
      const junior = { userId: users.junior, workspaceId, assignedMatterIds: new Set([assigned]) };
      expect(
        await codeOf(restrictMatter(tx, junior, { matterId: randomUUID(), allowedUserIds: [] })),
      ).toBe('NOT_FOUND');
      expect(
        await codeOf(restrictMatter(tx, junior, { matterId: assigned, allowedUserIds: [] })),
      ).toBe('FORBIDDEN');
      for (const role of ['advocate', 'owner'] as const) {
        const matterId = randomUUID();
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

  it('takes the role from the membership, not the caller', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const claimsOwner = { userId: users.viewer, workspaceId, role: 'owner' as const };
      expect(
        await codeOf(
          restrictMatter(tx, claimsOwner, { matterId: randomUUID(), allowedUserIds: [] }),
        ),
      ).toBe('FORBIDDEN');
      const outsider = { userId: users.outsider, workspaceId, role: 'owner' as const };
      expect(
        await codeOf(restrictMatter(tx, outsider, { matterId: randomUUID(), allowedUserIds: [] })),
      ).toBe('NOT_FOUND');
    });
  });

  it('keeps one row per (workspace, matter): restricting again replaces the allow list', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const matterId = randomUUID();
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
            { matterId: randomUUID(), allowedUserIds: [users.outsider] },
          ),
        ),
      ).toBe('VALIDATION');
    });
  });

  it('is NOT_FOUND for an advocate not listed on an already restricted matter', async () => {
    await withTestDb(async (tx) => {
      const { workspaceId, users } = await seed(tx);
      const matterId = randomUUID();
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
      const matterId = randomUUID();
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
