// workspace_integration (#287): a tenant table under FORCE row-level security (via `tenantTable()`),
// one row per (workspace_id, kind), a token hash unique across workspaces, and only the two kinds.
import { createHash, randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { registeredTenantTables } from '../rls-policies.ts';
import { workspaceIntegration, type IntegrationKind } from '../schema/workspace-integration.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const hash = () => createHash('sha256').update(randomBytes(32)).digest('hex');

describe('workspace_integration', () => {
  it('is registered as a tenant table and is under FORCE RLS with ws_isolation', async () => {
    expect(registeredTenantTables()).toContain('workspace_integration');
    await withTestDb(async (tx) => {
      const [row] = await tx.execute<{ enabled: boolean; forced: boolean; policies: string[] }>(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies
          from pg_class c where c.relname = 'workspace_integration'`);
      expect(row).toEqual({ enabled: true, forced: true, policies: ['ws_isolation'] });
    });
  });

  it('keeps one row per (workspace, kind), unique token hashes and only the known kinds', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const tokenHash = hash();
        const [row] = await s
          .insert(workspaceIntegration)
          .values({ workspaceId: ws.id, kind: 'ics_feed', tokenHash })
          .returning();
        expect(row?.rotatedAt).toBeNull();
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(workspaceIntegration)
                .values({ workspaceId: ws.id, kind: 'ics_feed', tokenHash: hash() }),
            ),
          ),
        ).toBe('23505');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(workspaceIntegration)
                .values({ workspaceId: ws.id, kind: 'email_intake', tokenHash }),
            ),
          ),
        ).toBe('23505');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(workspaceIntegration).values({
                workspaceId: ws.id,
                kind: 'webhook' as IntegrationKind,
                tokenHash: hash(),
              }),
            ),
          ),
        ).toBe('23514');
      });
    });
  });

  it('rows are invisible outside their workspace and cannot be written into another', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      await inWorkspace(tx, a.id, (s) =>
        s
          .insert(workspaceIntegration)
          .values({ workspaceId: a.id, kind: 'email_intake', tokenHash: hash() }),
      );
      await inWorkspace(tx, b.id, async (s) => {
        expect(await s.select().from(workspaceIntegration)).toEqual([]);
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(workspaceIntegration)
                .values({ workspaceId: a.id, kind: 'ics_feed', tokenHash: hash() }),
            ),
          ),
        ).toBe('42501');
      });
    });
  });
});
