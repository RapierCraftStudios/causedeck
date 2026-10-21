// matter_restriction (#233): a tenant table under FORCE row-level security (via `tenantTable()`),
// one row per (workspace_id, matter_id), invisible outside its workspace.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { registeredTenantTables } from '../rls-policies.ts';
import { matterRestriction } from '../schema/matter-restriction.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

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
      const matterId = randomUUID();
      await inWorkspace(tx, ws.id, async (s) => {
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
          .values({ workspaceId: ws.id, matterId: randomUUID(), createdBy })
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
      await inWorkspace(tx, a.id, (s) =>
        s
          .insert(matterRestriction)
          .values({ workspaceId: a.id, matterId: randomUUID(), createdBy }),
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
});
