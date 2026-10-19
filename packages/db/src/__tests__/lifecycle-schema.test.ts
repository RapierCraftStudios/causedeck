// Lifecycle tables (#301, 0024_lifecycle): export_job and deletion_job are tenant tables under
// FORCE row-level security; their check constraints hold; one export in flight per requester;
// deletion_tombstone is global, write-once for the app role; app_export_due_jobs returns ids only.
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { GLOBAL_TABLES } from '../conventions.ts';
import { registeredTenantTables } from '../rls-policies.ts';
import { deletionJob, deletionTombstone, exportJob } from '../schema/lifecycle.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

describe('lifecycle tables', () => {
  it('puts export_job and deletion_job under FORCE RLS; deletion_tombstone is global', async () => {
    expect(registeredTenantTables()).toEqual(
      expect.arrayContaining(['export_job', 'deletion_job']),
    );
    expect(GLOBAL_TABLES).toContain('deletion_tombstone');
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ name: string; enabled: boolean; forced: boolean }>(sql`
        select c.relname::text as name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced
          from pg_class c
         where c.relname in ('export_job', 'deletion_job', 'deletion_tombstone')
         order by 1`);
      expect(rows).toEqual([
        { name: 'deletion_job', enabled: true, forced: true },
        { name: 'deletion_tombstone', enabled: false, forced: false },
        { name: 'export_job', enabled: true, forced: true },
      ]);
    });
  });

  it('enforces the export_job checks and one export in flight per requester', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const requestedBy = ws.userIds[0] ?? '';
      await inWorkspace(tx, ws.id, async (s) => {
        const bad = async (values: Partial<typeof exportJob.$inferInsert>) =>
          sqlState(
            s.transaction((sp) =>
              sp.insert(exportJob).values({
                workspaceId: ws.id,
                requestedBy,
                scope: 'workspace',
                status: 'failed',
                ...values,
              }),
            ),
          );
        expect(await bad({ scope: 'everything' as 'user' })).toBe('23514');
        expect(await bad({ status: 'done' as 'ready' })).toBe('23514');
        expect(await bad({ progress: 101 })).toBe('23514');
        // Ready needs the stored archive.
        expect(await bad({ status: 'ready' })).toBe('23514');

        await s.insert(exportJob).values({ workspaceId: ws.id, requestedBy, scope: 'workspace' });
        expect(await bad({ status: 'running' })).toBe('23505');
        // A finished export does not block a new one.
        await s
          .insert(exportJob)
          .values({ workspaceId: ws.id, requestedBy, scope: 'user', status: 'expired' });
      });
    });
  });

  it('keeps export_job and deletion_job rows inside their workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const requestedBy = a.userIds[0] ?? '';
      await inWorkspace(tx, a.id, async (s) => {
        await s.insert(exportJob).values({ workspaceId: a.id, requestedBy, scope: 'workspace' });
        await s.insert(deletionJob).values({ workspaceId: a.id, kind: 'workspace', requestedBy });
      });
      await inWorkspace(tx, b.id, async (s) => {
        expect(await s.select().from(exportJob)).toEqual([]);
        expect(await s.select().from(deletionJob)).toEqual([]);
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(exportJob).values({ workspaceId: a.id, requestedBy, scope: 'workspace' }),
            ),
          ),
        ).toBe('42501');
      });
    });
  });

  it('allows a null workspace only for account deletions', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const requestedBy = ws.userIds[0] ?? '';
      await inWorkspace(tx, ws.id, async (s) => {
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(deletionJob).values({ workspaceId: ws.id, kind: 'account', requestedBy }),
            ),
          ),
        ).toBe('23514');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(deletionJob)
                .values({ workspaceId: ws.id, kind: 'purge' as 'memory', requestedBy }),
            ),
          ),
        ).toBe('23514');
      });
    });
  });

  it('lets the app role insert and read tombstones but never change or delete them', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = randomUUID();
      await tx.insert(deletionTombstone).values({ workspaceId, receiptHash: 'a'.repeat(64) });
      const [row] = await tx
        .select()
        .from(deletionTombstone)
        .where(sql`workspace_id = ${workspaceId}::uuid`);
      expect(row?.receiptHash).toBe('a'.repeat(64));
      expect(
        await sqlState(
          tx.transaction((sp) =>
            sp.execute(
              sql`update deletion_tombstone set receipt_hash = 'x' where workspace_id = ${workspaceId}::uuid`,
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await sqlState(
          tx.transaction((sp) =>
            sp.execute(
              sql`delete from deletion_tombstone where workspace_id = ${workspaceId}::uuid`,
            ),
          ),
        ),
      ).toBe('42501');
    });
  });

  it('app_export_due_jobs returns ids only, of ready exports past their expiry', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      const requestedBy = ws.userIds[0] ?? '';
      const due = randomUUID();
      const fresh = randomUUID();
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 3_600_000);
      await inWorkspace(tx, ws.id, (s) =>
        s.insert(exportJob).values(
          [
            { id: due, expiresAt: past },
            { id: fresh, expiresAt: future },
          ].map((r) => ({
            ...r,
            workspaceId: ws.id,
            requestedBy,
            scope: 'workspace' as const,
            status: 'ready' as const,
            blobId: randomUUID(),
            sha256: 'b'.repeat(64),
          })),
        ),
      );
      const rows = await tx.execute(
        sql`select * from app_export_due_jobs(now()) where workspace_id = ${ws.id}::uuid`,
      );
      expect(rows).toEqual([{ id: due, workspace_id: ws.id }]);
    });
  });
});
