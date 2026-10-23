// A user in two workspaces (#19, #209): `uboth` belongs to A and B and can act in each, but one
// transaction never mixes both. Switching workspace takes a new `withWorkspace` call; nesting the
// other workspace inside a scope throws TENANCY_VIOLATION.
import {
  registeredTenantTables,
  schema,
  TENANCY_VIOLATION,
  TenancyError,
  withWorkspace,
  type Transaction,
} from '@causedeck/db';
import { testAppDb, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as core from '../../index.ts';

/** The distinct workspace ids visible in every tenant table (and organization) on `tx`. */
async function visibleWorkspaces(tx: Transaction): Promise<string[]> {
  const ids = new Set<string>();
  for (const table of registeredTenantTables()) {
    const rows = await tx.execute<{ ws: string }>(
      sql.raw(`select distinct workspace_id::text as ws from "${table}"`),
    );
    for (const row of rows) ids.add(row.ws);
  }
  const orgs = await tx.select({ id: schema.organization.id }).from(schema.organization);
  for (const org of orgs) ids.add(org.id);
  return [...ids].sort();
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('a user in workspaces A and B (uboth)', () => {
  it('acts in each workspace and sees only that workspace in every tenant table', async () => {
    await withTestDb(async (tx) => {
      const { a, b, uboth } = await seedTwoTenants(tx);
      expect(await core.memberRole(tx, uboth, a.id)).toBe('advocate');
      expect(await core.memberRole(tx, uboth, b.id)).toBe('advocate');
      const memberships = await core.listMemberships(tx, uboth);
      expect(memberships.map((m) => m.workspaceId).sort()).toEqual([a.id, b.id].sort());

      for (const ws of [a, b]) {
        await withWorkspace(tx, { workspaceId: ws.id, userId: uboth }, async (s) => {
          expect(await visibleWorkspaces(s)).toEqual([ws.id]);
          const members = await core.listMembers(s, ws.id);
          expect(members.map((m) => m.userId)).toContain(uboth);
          // The other workspace's members are not reachable through the service either.
          const other = ws.id === a.id ? b.id : a.id;
          expect(await core.listMembers(s, other)).toEqual([]);
        });
      }
    });
  });

  it('cannot open the other workspace inside a scope, on the same transaction or the root db', async () => {
    await withTestDb(async (tx) => {
      const { a, b, uboth } = await seedTwoTenants(tx);
      await withWorkspace(tx, { workspaceId: a.id, userId: uboth }, async (s) => {
        for (const db of [s, testAppDb()]) {
          const error = await rejection(
            withWorkspace(db, { workspaceId: b.id, userId: uboth }, () => Promise.resolve()),
          );
          expect(error).toBeInstanceOf(TenancyError);
          expect((error as TenancyError).code).toBe(TENANCY_VIOLATION);
        }
        // The same workspace nests freely and still sees only A.
        await withWorkspace(s, { workspaceId: a.id, userId: uboth }, async (inner) => {
          expect(await visibleWorkspaces(inner)).toEqual([a.id]);
        });
        expect(await visibleWorkspaces(s)).toEqual([a.id]);
      });
    });
  });

  it('switching takes a new withWorkspace call, and sequential scopes do not leak', async () => {
    await withTestDb(async (tx) => {
      const { a, b, uboth } = await seedTwoTenants(tx);
      const first = await withWorkspace(
        tx,
        { workspaceId: a.id, userId: uboth },
        visibleWorkspaces,
      );
      const second = await withWorkspace(
        tx,
        { workspaceId: b.id, userId: uboth },
        visibleWorkspaces,
      );
      const third = await withWorkspace(
        tx,
        { workspaceId: a.id, userId: uboth },
        visibleWorkspaces,
      );
      expect([first, second, third]).toEqual([[a.id], [b.id], [a.id]]);
      // Between scopes the outer transaction has no workspace pinned and sees no tenant rows.
      expect(await visibleWorkspaces(tx)).toEqual([]);
    });
  });
});
