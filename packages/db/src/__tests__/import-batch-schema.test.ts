// The bootstrap import tables (#546): FORCE RLS with ws_isolation, the status and count CHECKs,
// composite FKs that keep a batch, its files and its plan inside one workspace, the column
// allow-list that proves non-matched row content is never stored, and the 30-day plan purge.
import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { registeredTenantTables } from '../rls-policies.ts';
import { capture } from '../schema/capture.ts';
import { importBatch, importBatchFile, importPlan } from '../schema/import-batch.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { newWorkspace, sqlState } from './rls/fixtures.ts';

const TABLES = ['import_batch', 'import_batch_file', 'import_plan'];

describe('import batch tables', () => {
  it('are tenant tables under FORCE RLS with ws_isolation (and the owner definer policies)', async () => {
    expect(registeredTenantTables()).toEqual(expect.arrayContaining(TABLES));
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ name: string; forced: boolean; policies: string[] }>(sql`
        select c.relname::text as name, c.relforcerowsecurity as forced,
               array(select polname::text from pg_policy where polrelid = c.oid order by 1) as policies
          from pg_class c
         where c.relname in ('import_batch', 'import_batch_file', 'import_plan') order by 1`);
      expect(rows).toEqual([
        {
          name: 'import_batch',
          forced: true,
          policies: ['owner_definer_read', 'ws_isolation'],
        },
        { name: 'import_batch_file', forced: true, policies: ['ws_isolation'] },
        {
          name: 'import_plan',
          forced: true,
          policies: ['owner_definer_purge', 'owner_definer_read', 'ws_isolation'],
        },
      ]);
    });
  });

  it('stores unmatched rows as a counter only: no column besides the plan holds row content', async () => {
    await withTestDb(async (tx) => {
      const cols = await tx.execute<{ table_name: string; column_name: string; data_type: string }>(
        sql`select table_name::text, column_name::text, data_type::text
              from information_schema.columns
             where table_schema = 'public' and table_name in ('import_batch', 'import_batch_file', 'import_plan')
               and data_type in ('text', 'jsonb', 'json', 'bytea', 'ARRAY')
             order by 1, 2`,
      );
      expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
        'import_batch.plan_hash',
        'import_batch.status',
        'import_batch_file.adapter_id',
        'import_batch_file.status',
        'import_plan.plan',
      ]);
      const [counter] = await tx.execute<{ data_type: string }>(
        sql`select data_type::text from information_schema.columns
             where table_name = 'import_batch' and column_name = 'unmatched_rows_count'`,
      );
      expect(counter?.data_type).toBe('integer');
    });
  });

  it('defaults a batch to pending with zero counts and rejects bad status, counts and hash', async () => {
    await withTestDb(async (tx) => {
      const ws = await newWorkspace(tx);
      await inWorkspace(tx, ws.id, async (s) => {
        const [row] = await s.insert(importBatch).values({ workspaceId: ws.id }).returning();
        expect(row).toMatchObject({
          status: 'pending',
          fileCount: 0,
          matchedRows: 0,
          unmatchedRowsCount: 0,
          planHash: null,
          appliedAt: null,
        });
        const bad: Record<string, unknown>[] = [
          { status: 'done' },
          { fileCount: -1 },
          { matchedRows: -1 },
          { unmatchedRowsCount: -1 },
          { planHash: 'ABC' },
        ];
        for (const patch of bad) {
          const state = await sqlState(
            s.transaction((sp) =>
              sp.insert(importBatch).values({ workspaceId: ws.id, ...patch } as never),
            ),
          );
          expect(state, JSON.stringify(patch)).toBe('23514');
        }
      });
    });
  });

  it('keeps files and plans inside their workspace and requires an object plan', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      const [batchA] = await inWorkspace(tx, a.id, (s) =>
        s.insert(importBatch).values({ workspaceId: a.id }).returning(),
      );
      const [captureB] = await inWorkspace(tx, b.id, (s) =>
        s
          .insert(capture)
          .values({ workspaceId: b.id, channel: 'upload', mime: 'image/png', sizeBytes: 1 })
          .returning(),
      );
      await inWorkspace(tx, a.id, async (s) => {
        const batchId = batchA?.id ?? '';
        // A capture of workspace B, a plan for a batch of B, a non-object plan.
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp
                .insert(importBatchFile)
                .values({ workspaceId: a.id, batchId, captureId: captureB?.id ?? '' }),
            ),
          ),
        ).toBe('23503');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(importPlan).values({ workspaceId: a.id, batchId: randomUUID(), plan: {} }),
            ),
          ),
        ).toBe('23503');
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(importPlan).values({ workspaceId: a.id, batchId, plan: [] as never }),
            ),
          ),
        ).toBe('23514');
        await s.insert(importPlan).values({ workspaceId: a.id, batchId, plan: { rows: [] } });
        expect(
          await sqlState(
            s.transaction((sp) =>
              sp.insert(importPlan).values({ workspaceId: a.id, batchId, plan: {} }),
            ),
          ),
        ).toBe('23505');
      });
    });
  });

  it('purges plans 30 days after apply, in every workspace, and keeps batch rows', async () => {
    await withTestDb(async (tx) => {
      const hash = createHash('sha256').update(randomUUID()).digest('hex');
      const day = 24 * 60 * 60 * 1000;
      const seeded: { ws: string; batch: string; kind: 'old' | 'recent' | 'unapplied' }[] = [];
      for (const kind of ['old', 'recent', 'unapplied', 'old'] as const) {
        const ws = await newWorkspace(tx);
        await inWorkspace(tx, ws.id, async (s) => {
          const [batch] = await s
            .insert(importBatch)
            .values({
              workspaceId: ws.id,
              ...(kind === 'unapplied'
                ? {}
                : {
                    status: 'applied' as const,
                    planHash: hash,
                    appliedAt: new Date(Date.now() - (kind === 'old' ? 31 : 29) * day),
                  }),
            })
            .returning();
          await s
            .insert(importPlan)
            .values({ workspaceId: ws.id, batchId: batch?.id ?? '', plan: { rows: [1] } });
          seeded.push({ ws: ws.id, batch: batch?.id ?? '', kind });
        });
      }
      const [res] = await tx.execute<{ n: string }>(
        sql`select app_purge_import_plans(now() - make_interval(days => 30))::text as n`,
      );
      expect(Number(res?.n)).toBeGreaterThanOrEqual(2);
      for (const { ws, batch, kind } of seeded) {
        await inWorkspace(tx, ws, async (s) => {
          const plans = await s.execute<{ n: number }>(
            sql`select count(*)::int as n from import_plan where batch_id = ${batch}`,
          );
          const batches = await s.execute<{ n: number }>(
            sql`select count(*)::int as n from import_batch where id = ${batch}`,
          );
          expect(plans[0]?.n, kind).toBe(kind === 'old' ? 0 : 1);
          expect(batches[0]?.n, kind).toBe(1);
        });
      }
    });
  });
});
