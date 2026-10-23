// Role model (#19): the apps connect as causedeck_app, which owns no table, cannot bypass RLS and
// cannot become the owner, so it cannot turn row-level security off.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { withTestDb } from '../../testing/index.ts';
import { sqlState } from './fixtures.ts';

/** insufficient_privilege (must be owner / permission denied to set role). */
const DENIED = '42501';

describe('causedeck_app privileges', () => {
  it('is not the owner of any tenant table and has no superuser or BYPASSRLS', async () => {
    await withTestDb(async (tx) => {
      const [role] = await tx.execute<{ who: string; superuser: boolean; bypass: boolean }>(sql`
        select current_user as who, rolsuper as superuser, rolbypassrls as bypass
        from pg_roles where rolname = current_user`);
      expect(role).toEqual({ who: 'causedeck_app', superuser: false, bypass: false });
      const owners = await tx.execute<{ owner: string }>(sql`
        select distinct tableowner as owner from pg_tables
        where schemaname = 'public'
          and tablename in ('organization', 'member', 'invitation', 'workspace_settings',
                            'workspace_slug_history', 'job_effect')`);
      expect(owners).toEqual([{ owner: 'causedeck_owner' }]);
    });
  });

  it.each([
    ['ALTER TABLE', sql`alter table member add column sneaky int`],
    ['DISABLE ROW LEVEL SECURITY', sql`alter table member disable row level security`],
    ['NO FORCE ROW LEVEL SECURITY', sql`alter table member no force row level security`],
    ['DROP POLICY', sql`drop policy ws_isolation on member`],
    ['SET ROLE to the owner', sql`set role causedeck_owner`],
    ['SET SESSION AUTHORIZATION', sql`set session authorization causedeck_owner`],
  ])('cannot %s', async (_label, statement) => {
    await withTestDb(async (tx) => {
      expect(await sqlState(tx.transaction((sp) => sp.execute(statement)))).toBe(DENIED);
    });
  });
});
