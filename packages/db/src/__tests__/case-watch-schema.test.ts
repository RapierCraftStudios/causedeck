// Case-status watch schema (#589, part 1 of #483): the CHECK and unique constraints of `case_watch`
// and `case_status_snapshot`, the cascade from proceeding to watch to snapshot, and that workspace B
// can neither see nor add rows to workspace A's watches.
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { caseStatusSnapshot, caseWatch } from '../schema/case-watch.ts';
import { proceeding } from '../schema/proceedings.ts';
import { closeTestDb, inWorkspace, withTestDb } from '../testing/index.ts';
import { seedTwoTenants } from '../testing/two-tenants.ts';

import { sqlState } from './rls/fixtures.ts';

afterAll(closeTestDb);

const HASH = 'b'.repeat(64);

/** Run `fn` in a savepoint and return the violated constraint's name (or undefined on success). */
async function violation(tx: Transaction, fn: (sp: Transaction) => Promise<unknown>) {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { constraint_name?: string } }).cause;
    return cause?.constraint_name ?? (error as { constraint_name?: string }).constraint_name;
  }
}

describe('case_watch and case_status_snapshot', () => {
  it('enforces the watch and snapshot constraints', async () => {
    await withTestDb(async (tx) => {
      const { a, ua } = await seedTwoTenants(tx);
      const watch = a.rows['case_watch'];
      const proceedingId = watch?.['proceedingId'] ?? '';
      await inWorkspace(tx, a.id, async (s) => {
        const [row] = await s
          .select()
          .from(caseWatch)
          .where(eq(caseWatch.id, watch?.['id'] ?? ''));
        expect(row?.cnr).toBe('TNCH010012342024');
        const base = {
          workspaceId: a.id,
          proceedingId: row?.proceedingId ?? proceedingId,
          advocateUserId: ua,
        };

        expect(
          await violation(s, (sp) =>
            sp.insert(caseWatch).values({ ...base, sourceId: 'xt.case-watch', cnr: 'bad' }),
          ),
        ).toBe('case_watch_cnr_chk');
        expect(
          await violation(s, (sp) =>
            sp.insert(caseWatch).values({ ...base, sourceId: 'xt.case-watch' }),
          ),
        ).toBe('case_watch_target_chk');
        expect(
          await violation(s, (sp) =>
            sp.insert(caseWatch).values({
              ...base,
              sourceId: 'xt.case-watch',
              caseNumber: 'WP/1/2024',
              cadenceMinutes: 0,
            }),
          ),
        ).toBe('case_watch_cadence_chk');
        // The same proceeding at the same source is watched once.
        expect(
          await violation(s, (sp) =>
            sp
              .insert(caseWatch)
              .values({ ...base, sourceId: 'xt.case-watch', caseNumber: 'WP/1/2024' }),
          ),
        ).toBe('case_watch_workspace_proceeding_source_uq');

        const snap = {
          workspaceId: a.id,
          watchId: row?.id ?? '',
          fields: { stage: 'listed' },
          via: 'server' as const,
          tierUsed: 'captcha' as const,
          sourceType: 'manual' as const,
        };
        await s.insert(caseStatusSnapshot).values({ ...snap, contentHash: HASH });
        expect(
          await violation(s, (sp) =>
            sp.insert(caseStatusSnapshot).values({ ...snap, contentHash: HASH }),
          ),
        ).toBe('case_status_snapshot_watch_hash_uq');
        expect(
          await violation(s, (sp) =>
            sp.insert(caseStatusSnapshot).values({ ...snap, contentHash: 'XYZ' }),
          ),
        ).toBe('case_status_snapshot_hash_chk');
        expect(
          await violation(s, (sp) =>
            sp
              .insert(caseStatusSnapshot)
              .values({ ...snap, contentHash: 'c'.repeat(64), via: 'phone' as 'device' }),
          ),
        ).toBe('case_status_snapshot_via_chk');
        expect(
          await violation(s, (sp) =>
            sp
              .insert(caseStatusSnapshot)
              .values({ ...snap, contentHash: 'd'.repeat(64), costDollars: '-1' }),
          ),
        ).toBe('case_status_snapshot_cost_chk');
      });
    });
  });

  it('deletes watches and snapshots with their proceeding', async () => {
    await withTestDb(async (tx) => {
      const { a } = await seedTwoTenants(tx);
      const snapshotRow = a.rows['case_status_snapshot'];
      await inWorkspace(tx, a.id, async (s) => {
        const [w] = await s
          .select({ proceedingId: caseWatch.proceedingId })
          .from(caseWatch)
          .where(eq(caseWatch.id, snapshotRow?.['watchId'] ?? ''));
        await s.delete(proceeding).where(eq(proceeding.id, w?.proceedingId ?? ''));
        const left = await s
          .select({ id: caseStatusSnapshot.id })
          .from(caseStatusSnapshot)
          .where(eq(caseStatusSnapshot.id, snapshotRow?.['id'] ?? ''));
        expect(left).toEqual([]);
      });
    });
  });

  it("keeps workspace A's watches and snapshots away from workspace B", async () => {
    await withTestDb(async (tx) => {
      const { a, b, ub } = await seedTwoTenants(tx);
      const aWatch = a.rows['case_watch']?.['id'] ?? '';
      await inWorkspace(
        tx,
        b.id,
        async (s) => {
          const watches = await s.select().from(caseWatch).where(eq(caseWatch.id, aWatch));
          expect(watches).toEqual([]);
          expect(
            await s
              .select()
              .from(caseStatusSnapshot)
              .where(sql`workspace_id = ${a.id}`),
          ).toEqual([]);
          // B cannot add a snapshot to A's watch, nor a watch row stamped with A's workspace.
          const bad = await sqlState(
            s.transaction((sp) =>
              sp.insert(caseStatusSnapshot).values({
                workspaceId: a.id,
                watchId: aWatch,
                fields: {},
                contentHash: HASH,
                via: 'device',
                sourceType: 'manual',
              }),
            ),
          );
          expect(bad).toBe('42501');
          const forged = await sqlState(
            s.transaction((sp) =>
              sp.insert(caseWatch).values({
                workspaceId: a.id,
                proceedingId: a.rows['proceeding']?.['proceedingId'] ?? '',
                sourceId: 'xt.case-watch',
                cnr: 'TNCH010012342024',
                advocateUserId: ub,
              }),
            ),
          );
          expect(forged).toBe('42501');
        },
        ub,
      );
    });
  });
});
