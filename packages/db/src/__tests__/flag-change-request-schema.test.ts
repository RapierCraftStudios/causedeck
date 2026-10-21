// flag_change_request (#311): a global, staff-only table of legal-gated flag enables waiting for a
// second admin. No RLS; the app role may read, insert and update but never delete; one pending
// request per (key, workspace) target; the decider is never the requester; account deletion
// nulls the actors and a deleted workspace takes its requests with it.
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';
import { organization, user } from '../schema/auth.ts';
import { flagChangeRequest } from '../schema/flags.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newUser, newWorkspace, sqlState } from './rls/fixtures.ts';

describe('flag_change_request', () => {
  it('is a global table without RLS that the app role cannot delete from', async () => {
    expect(GLOBAL_TABLES).toContain('flag_change_request');
    await withTestDb(async (tx) => {
      const [row] = await tx.execute<{ enabled: boolean; forced: boolean }>(sql`
        select c.relrowsecurity as enabled, c.relforcerowsecurity as forced
          from pg_class c where c.relname = 'flag_change_request'`);
      expect(row).toEqual({ enabled: false, forced: false });

      const requester = await newUser(tx);
      const [req] = await tx
        .insert(flagChangeRequest)
        .values({ key: 'invoices.enabled', legalAckNote: 'note', requestedBy: requester })
        .returning({ id: flagChangeRequest.id });
      if (!req) throw new Error('insert failed');
      await tx
        .update(flagChangeRequest)
        .set({ status: 'rejected', decidedAt: new Date() })
        .where(eq(flagChangeRequest.id, req.id));
      expect(
        await sqlState(
          tx.transaction((sp) =>
            sp.delete(flagChangeRequest).where(eq(flagChangeRequest.id, req.id)),
          ),
        ),
      ).toBe('42501');
    });
  });

  it('rejects self-approval, an undecided decision and an unknown status', async () => {
    await withTestDb(async (tx) => {
      const requester = await newUser(tx);
      const insert = (values: Partial<typeof flagChangeRequest.$inferInsert>) =>
        sqlState(
          tx.transaction((sp) =>
            sp.insert(flagChangeRequest).values({
              key: 'invoices.enabled',
              legalAckNote: 'note',
              requestedBy: requester,
              ...values,
            }),
          ),
        );
      expect(
        await insert({ status: 'approved', decidedBy: requester, decidedAt: new Date() }),
      ).toBe('23514');
      expect(await insert({ status: 'approved' })).toBe('23514');
      expect(await insert({ status: 'maybe' as never, decidedAt: new Date() })).toBe('23514');
    });
  });

  it('allows one pending request per target, and new ones once decided', async () => {
    await withTestDb(async (tx) => {
      const requester = await newUser(tx);
      const ws = await newWorkspace(tx);
      const pending = (workspaceId: string | null) =>
        sqlState(
          tx.transaction((sp) =>
            sp.insert(flagChangeRequest).values({
              key: 'limitation.enabled',
              workspaceId,
              legalAckNote: 'note',
              requestedBy: requester,
            }),
          ),
        );
      expect(await pending(null)).toBeUndefined();
      expect(await pending(null)).toBe('23505');
      expect(await pending(ws.id)).toBeUndefined();
      expect(await pending(ws.id)).toBe('23505');

      await tx
        .update(flagChangeRequest)
        .set({ status: 'rejected', decidedAt: new Date() })
        .where(eq(flagChangeRequest.key, 'limitation.enabled'));
      expect(await pending(null)).toBeUndefined();
    });
  });

  it('nulls deleted actors and cascades with the workspace', async () => {
    await withTestDb(async (tx) => {
      const requester = await newUser(tx);
      const decider = await newUser(tx);
      const ws = await newWorkspace(tx);
      const [global] = await tx
        .insert(flagChangeRequest)
        .values({
          key: 'invoices.enabled',
          legalAckNote: 'note',
          requestedBy: requester,
          decidedBy: decider,
          status: 'approved',
          decidedAt: new Date(),
        })
        .returning({ id: flagChangeRequest.id });
      await tx.insert(flagChangeRequest).values({
        key: 'invoices.enabled',
        workspaceId: ws.id,
        legalAckNote: 'pilot',
        requestedBy: requester,
      });
      if (!global) throw new Error('insert failed');

      await tx.delete(user).where(eq(user.id, requester));
      await tx.delete(user).where(eq(user.id, decider));
      const [row] = await tx
        .select()
        .from(flagChangeRequest)
        .where(eq(flagChangeRequest.id, global.id));
      expect(row).toMatchObject({ requestedBy: null, decidedBy: null, status: 'approved' });

      await inWorkspace(tx, ws.id, (s) => s.delete(organization).where(eq(organization.id, ws.id)));
      expect(
        await tx.select().from(flagChangeRequest).where(eq(flagChangeRequest.workspaceId, ws.id)),
      ).toEqual([]);
    });
  });
});
