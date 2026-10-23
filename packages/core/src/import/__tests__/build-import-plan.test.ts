// `buildImportPlan` against the database (#548): the matched-only rule leaves no trace of a
// non-matched row in the database or the logs, the plan and counters are stored, an applied batch
// is final, and another workspace's batch is NOT_FOUND (cross-tenant).
import { randomUUID } from 'node:crypto';

import { parseAdvocate } from '@causedeck/adapters';
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceError } from '../../shared/errors.ts';
import { buildImportPlan } from '../bootstrap.ts';
import { SECRET } from '../fixtures/bundles.ts';
import { getAdvocateIdentifiers } from '../identifiers.ts';

const identifiers = getAdvocateIdentifiers({ enrolmentNumbers: ['MS/123/1900'] });
const NOW = () => new Date('2026-11-10T06:00:00Z');

async function stage(
  tx: Transaction,
  workspaceId: string,
  captureId: string,
  matchKey: string,
  advocate: string,
): Promise<void> {
  await inWorkspace(tx, workspaceId, (s) =>
    s.insert(schema.proposal).values({
      workspaceId,
      captureId,
      kind: 'new_proceeding',
      level: 'L2',
      payload: {
        matchKey,
        caseTypeRaw: 'W.P.',
        caseNumber: '1',
        caseYear: 2026,
        listDate: '2026-11-12',
        advocates: [parseAdvocate(advocate)],
      },
      meta: { source: { type: 'deterministic', input: 'list' } },
      idempotencyKey: randomUUID(),
    }),
  );
}

describe('buildImportPlan', () => {
  it('stores matched rows only and leaves no non-matched content in the database or logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const logged: string[] = [];
    try {
      await withTestDb(async (tx) => {
        const seeded = await seedTwoTenants(tx);
        const { batchId, captureId } = seeded.a.rows.import_batch_file ?? {};
        if (batchId === undefined || captureId === undefined) throw new Error('seed missing');
        await stage(tx, seeded.a.id, captureId, 'WP/1/2026', 'Mr. R. Fictional MS/123/1900');
        await stage(tx, seeded.a.id, captureId, `${SECRET}/2/2026`, `Mr. Z. Stranger ${SECRET}`);

        const plan = await buildImportPlan(
          {
            db: tx,
            now: NOW,
            log: (event, counts) => logged.push(JSON.stringify({ event, counts })),
          },
          { workspaceId: seeded.a.id, batchId, identifiers },
        );
        expect(plan.counts).toEqual({ matchedRows: 1, unmatchedRowsCount: 1 });
        expect(plan.matters).toHaveLength(1);
        expect(plan.matters[0]?.nextDate?.date).toBe('2026-11-12');

        const stored = await inWorkspace(tx, seeded.a.id, async (s) => ({
          plan: await s
            .select()
            .from(schema.importPlan)
            .where(eq(schema.importPlan.batchId, batchId)),
          batch: await s
            .select()
            .from(schema.importBatch)
            .where(eq(schema.importBatch.id, batchId)),
          files: await s
            .select()
            .from(schema.importBatchFile)
            .where(eq(schema.importBatchFile.batchId, batchId)),
        }));
        expect(stored.plan).toHaveLength(1);
        expect(stored.batch[0]).toMatchObject({ matchedRows: 1, unmatchedRowsCount: 1 });
        expect(stored.files[0]?.rowsMatched).toBe(1);
        expect(JSON.stringify(stored)).not.toContain(SECRET);
      });
      expect(logged.length).toBeGreaterThan(0);
      expect(logged.join('\n')).not.toContain(SECRET);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it('is final once the batch is applied', async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const batchId = seeded.a.rows.import_batch_file?.batchId;
      if (batchId === undefined) throw new Error('seed missing');
      await inWorkspace(tx, seeded.a.id, (s) =>
        s
          .update(schema.importBatch)
          .set({ status: 'applied' })
          .where(eq(schema.importBatch.id, batchId)),
      );
      await expect(
        buildImportPlan({ db: tx, now: NOW }, { workspaceId: seeded.a.id, batchId, identifiers }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it("denies workspace B on workspace A's batch and leaves A unchanged", async () => {
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const { batchId, captureId } = seeded.a.rows.import_batch_file ?? {};
      if (batchId === undefined || captureId === undefined) throw new Error('seed missing');
      await stage(tx, seeded.a.id, captureId, 'WP/1/2026', 'Mr. R. Fictional MS/123/1900');

      const error: unknown = await buildImportPlan(
        { db: tx, now: NOW },
        { workspaceId: seeded.b.id, batchId, identifiers },
      ).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(WorkspaceError);
      expect((error as WorkspaceError).code).toBe('NOT_FOUND');

      const after = await inWorkspace(tx, seeded.a.id, async (s) => ({
        plans: await s
          .select()
          .from(schema.importPlan)
          .where(eq(schema.importPlan.batchId, batchId)),
        batch: await s.select().from(schema.importBatch).where(eq(schema.importBatch.id, batchId)),
      }));
      expect(after.plans).toEqual([]);
      expect(after.batch[0]).toMatchObject({ matchedRows: 0, unmatchedRowsCount: 0 });
    });
  });
});
