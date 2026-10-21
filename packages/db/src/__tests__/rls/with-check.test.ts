// WITH CHECK (#19): a scoped transaction cannot write rows into, or move rows to, another workspace.
import { randomUUID } from 'node:crypto';

import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { member, organization } from '../../schema/auth.ts';
import { jobEffect } from '../../schema/job-effect.ts';
import { inWorkspace, withTestDb } from '../../testing/index.ts';
import { newUser, newWorkspace, sqlState } from './fixtures.ts';

/** insufficient_privilege: how Postgres reports a row-level security violation. */
const RLS_VIOLATION = '42501';

describe('ws_isolation WITH CHECK', () => {
  it('rejects an INSERT that sets workspace_id to another workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const userId = await newUser(tx);
      expect(
        await sqlState(
          inWorkspace(tx, a.id, (s) =>
            s.insert(member).values({ organizationId: b.id, userId, role: 'advocate' }),
          ),
        ),
      ).toBe(RLS_VIOLATION);
      expect(
        await sqlState(
          inWorkspace(tx, a.id, (s) =>
            s.insert(jobEffect).values({ jobName: 'x', idempotencyKey: 'k', workspaceId: b.id }),
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('rejects any tenant INSERT with no workspace pinned', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      expect(
        await sqlState(
          tx.transaction((sp) =>
            sp.insert(jobEffect).values({ jobName: 'x', idempotencyKey: 'k', workspaceId: a.id }),
          ),
        ),
      ).toBe(RLS_VIOLATION);
      expect(
        await sqlState(
          tx.transaction((sp) =>
            sp
              .insert(organization)
              .values({ id: randomUUID(), name: 'X', slug: `x-${randomUUID()}` }),
          ),
        ),
      ).toBe(RLS_VIOLATION);
    });
  });

  it('rejects UPDATE ... SET workspace_id that moves a row to another workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      expect(
        await sqlState(
          inWorkspace(tx, a.id, (s) =>
            s.update(member).set({ organizationId: b.id }).where(eq(member.organizationId, a.id)),
          ),
        ),
      ).toBe(RLS_VIOLATION);
      expect(
        await sqlState(
          inWorkspace(tx, a.id, (s) =>
            s.execute(sql`update organization set id = ${b.id} where id = ${a.id}`),
          ),
        ),
      ).toBe(RLS_VIOLATION);
      // The row did not move.
      const rows = await inWorkspace(tx, a.id, (s) => s.select().from(member));
      expect(rows.map((m) => m.organizationId)).toEqual([a.id]);
    });
  });

  it('cannot update or delete another workspace’s rows (they are invisible)', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const touched = await inWorkspace(tx, a.id, async (s) => ({
        updated: await s
          .update(member)
          .set({ role: 'junior' })
          .where(eq(member.organizationId, b.id))
          .returning({ id: member.id }),
        deleted: await s
          .delete(member)
          .where(eq(member.organizationId, b.id))
          .returning({ id: member.id }),
      }));
      expect(touched).toEqual({ updated: [], deleted: [] });
      const rows = await inWorkspace(tx, b.id, (s) => s.select().from(member));
      expect(rows.map((m) => m.role)).toEqual(['advocate']);
    });
  });
});
