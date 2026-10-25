// matter_restriction (#233): a tenant table under FORCE row-level security (via `tenantTable()`),
// one row per (workspace_id, matter_id), invisible outside its workspace. Since #345 `matter_id`
// references `matter` through the composite (workspace_id, matter_id) FK, ON DELETE CASCADE.
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { registeredTenantTables } from '../rls-policies.ts';
import type { Transaction } from '../client.ts';
import { matter } from '../schema/matter-graph.ts';
import { matterRestriction } from '../schema/matter-restriction.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

/** A matter in the scoped workspace (the restriction FK needs one). */
async function newMatter(s: Transaction, workspaceId: string): Promise<string> {
  const [row] = await s
    .insert(matter)
    .values({ workspaceId, title: 'Restricted matter' })
    .returning({ id: matter.id });
  if (row === undefined) throw new Error('matter insert returned no row');
  return row.id;
}

describe('matter_restriction', () => {
  it('is registered as a tenant table and is under FORCE RLS with ws_isolation', async () => {
    expect(registeredTenantTables()).toContain('matter_restriction');
    await withTestDb(async (tx) => {
      const [row] = await tx.execute<{ enabled: boolean; forced: boolean; policies: string[] }>(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies
          from pg_class c where c.relname = 'matter_restriction'`);
      expect(row).toEqual({ enabled: true, forced: true, policies: ['ws_isolation'] });
    });
  });

  it('has a unique index on (workspace_id, matter_id)', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ def: string }>(sql`
        select pg_get_indexdef(i.indexrelid) as def from pg_index i
         where i.indrelid = 'matter_restriction'::regclass and i.indisunique and not i.indisprimary`);
      expect(rows.map((r) => r.def)).toEqual([
        expect.stringContaining('(workspace_id, matter_id)') as unknown,
      ]);

      const ws = await newWorkspace(tx);
      const createdBy = ws.userIds[0] ?? '';
      await inWorkspace(tx, ws.id, async (s) => {
        const matterId = await newMatter(s, ws.id);
        await s.insert(matterRestriction).values({ workspaceId: ws.id, matterId, createdBy });
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(matterRestriction).values({ workspaceId: ws.id, matterId, createdBy }),
            ),
          ),
        ).toBe('23505');
        // Another matter in the same workspace is fine; allowed_user_ids defaults to empty.
        const [other] = await s
          .insert(matterRestriction)
          .values({ workspaceId: ws.id, matterId: await newMatter(s, ws.id), createdBy })
          .returning();
        expect(other?.allowedUserIds).toEqual([]);
      });
    });
  });

  it('rows are invisible outside their workspace and cannot be written into another', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const createdBy = a.userIds[0] ?? '';
      await inWorkspace(tx, a.id, async (s) =>
        s
          .insert(matterRestriction)
          .values({ workspaceId: a.id, matterId: await newMatter(s, a.id), createdBy }),
      );
      await inWorkspace(tx, b.id, async (s) => {
        expect(await s.select().from(matterRestriction)).toEqual([]);
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(matterRestriction)
                .values({ workspaceId: a.id, matterId: randomUUID(), createdBy }),
            ),
          ),
        ).toBe('42501');
      });
    });
  });

  it('needs a matter of its own workspace and goes with it (#345)', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const createdBy = a.userIds[0] ?? '';
      const bMatter = await inWorkspace(tx, b.id, (s) => newMatter(s, b.id));
      await inWorkspace(tx, a.id, async (s) => {
        // No such matter, or another workspace's matter: a foreign-key violation either way.
        for (const matterId of [randomUUID(), bMatter]) {
          expect(
            await sqlState(
              s.transaction((sp) =>
                sp.insert(matterRestriction).values({ workspaceId: a.id, matterId, createdBy }),
              ),
            ),
          ).toBe('23503');
        }
        const matterId = await newMatter(s, a.id);
        await s.insert(matterRestriction).values({ workspaceId: a.id, matterId, createdBy });
        await s.delete(matter).where(eq(matter.id, matterId));
        expect(await s.select().from(matterRestriction)).toEqual([]);
      });
    });
  });
});
