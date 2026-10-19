// `matterVisibilityPredicate()` (#233) must agree with `can(actor, 'matter.read', matter)`: every
// role and setting is run over the same matters (restricted with and without the actor listed,
// unrestricted, assigned, owned) in SQL and in `can()`, and the visible sets must match.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { ROLES, type Role } from '../../roles';
import { can, type Actor, type PolicySettings, type Resource } from '../can';
import { matterVisibilityPredicate } from '../visibility';

interface Matter {
  id: string;
  owner: string;
  allow?: string[];
}

async function newUser(tx: Transaction): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: 'Advocate', email: `${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!row) throw new Error('user insert failed');
  return row.id;
}

/** Matter ids visible to `actor` through the predicate, over an inline `matter(id, owner)` table. */
async function visibleInSql(
  tx: Transaction,
  actor: Actor,
  matters: Matter[],
  settings: PolicySettings,
): Promise<string[]> {
  const values = sql.join(
    matters.map((m) => sql`(${m.id}::uuid, ${m.owner}::uuid)`),
    sql`, `,
  );
  const predicate = matterVisibilityPredicate(actor, sql`m.id`, {
    settings,
    ownerUserId: sql`m.owner`,
  });
  const rows = await inWorkspace(
    tx,
    actor.workspaceId,
    (s) =>
      s.execute<{ id: string }>(
        sql`select m.id::text as id from (values ${values}) as m(id, owner) where ${predicate} order by 1`,
      ),
    actor.userId,
  );
  return rows.map((r) => r.id);
}

function visibleInCan(actor: Actor, matters: Matter[], settings: PolicySettings): string[] {
  return matters
    .filter((m) => {
      const resource: Resource = {
        kind: 'matter',
        workspaceId: actor.workspaceId,
        matterId: m.id,
        ownerUserId: m.owner,
        ...(m.allow === undefined ? {} : { restricted: { allowUserIds: m.allow } }),
      };
      return can(actor, 'matter.read', resource, settings).allow;
    })
    .map((m) => m.id)
    .sort();
}

describe('matterVisibilityPredicate', () => {
  it('agrees with can() for every role, setting and kind of matter', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      const me = await newUser(tx);
      const other = await newUser(tx);
      const otherWorkspace = randomUUID();
      const m = (allow?: string[], owner = other): Matter => ({
        id: randomUUID(),
        owner,
        ...(allow === undefined ? {} : { allow }),
      });
      const open = m();
      const assigned = m();
      const mine = m(undefined, me);
      const listed = m([me]);
      const unlisted = m([other]);
      const emptyList = m([]);
      const assignedButRestricted = m([other]);
      const matters = [open, assigned, mine, listed, unlisted, emptyList, assignedButRestricted];

      await inWorkspace(tx, workspaceId, async (s) => {
        await s
          .insert(schema.organization)
          .values({ id: workspaceId, name: 'Chambers', slug: `vis-${workspaceId}` });
        await s.insert(schema.matterRestriction).values(
          matters
            .filter((x) => x.allow !== undefined)
            .map((x) => ({
              workspaceId,
              matterId: x.id,
              allowedUserIds: x.allow ?? [],
              createdBy: other,
            })),
        );
      });
      // The same matter id restricted in another workspace must not affect this one.
      await inWorkspace(tx, otherWorkspace, async (s) => {
        await s
          .insert(schema.organization)
          .values({ id: otherWorkspace, name: 'Other', slug: `vis-${otherWorkspace}` });
        await s.insert(schema.matterRestriction).values({
          workspaceId: otherWorkspace,
          matterId: open.id,
          allowedUserIds: [other],
          createdBy: other,
        });
      });

      const settingsCases: PolicySettings[] = [
        {},
        { ownersSeeRestrictedMatters: false },
        { disabledDomains: new Set(['matter'] as const) },
      ];
      for (const role of ROLES as readonly Role[]) {
        for (const settings of settingsCases) {
          for (const suspended of [false, true]) {
            const actor: Actor = {
              userId: me,
              workspaceId,
              role,
              assignedMatterIds: new Set([assigned.id, assignedButRestricted.id]),
              suspended,
            };
            const label = `${role} ${JSON.stringify({ ...settings, suspended })}`;
            expect(await visibleInSql(tx, actor, matters, settings), label).toEqual(
              visibleInCan(actor, matters, settings),
            );
          }
        }
      }

      // Spot checks of the expected outcome.
      const advocate: Actor = { userId: me, workspaceId, role: 'advocate' };
      expect(await visibleInSql(tx, advocate, matters, {})).toEqual(
        [open, assigned, mine, listed].map((x) => x.id).sort(),
      );
      const owner: Actor = { userId: me, workspaceId, role: 'owner' };
      expect(await visibleInSql(tx, owner, matters, {})).toHaveLength(matters.length);
      const junior: Actor = { userId: me, workspaceId, role: 'junior' };
      expect(await visibleInSql(tx, junior, matters, {})).toEqual(
        [mine, listed].map((x) => x.id).sort(),
      );
    });
  });

  it('a junior with no assignments and no owner column sees only listed matters', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      const me = await newUser(tx);
      const listed = randomUUID();
      const open = randomUUID();
      await inWorkspace(tx, workspaceId, async (s) => {
        await s
          .insert(schema.organization)
          .values({ id: workspaceId, name: 'Chambers', slug: `vis-${workspaceId}` });
        await s
          .insert(schema.matterRestriction)
          .values({ workspaceId, matterId: listed, allowedUserIds: [me], createdBy: me });
      });
      const predicate = matterVisibilityPredicate(
        { userId: me, workspaceId, role: 'junior' },
        sql`m.id`,
      );
      const rows = await inWorkspace(tx, workspaceId, (s) =>
        s.execute<{ id: string }>(
          sql`select m.id::text as id from (values (${listed}::uuid), (${open}::uuid)) as m(id) where ${predicate}`,
        ),
      );
      expect(rows.map((r) => r.id)).toEqual([listed]);
    });
  });
});
