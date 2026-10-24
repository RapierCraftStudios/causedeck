// Portfolio exception alerts (#665): a new adverse order and a missed next date reach every active
// member of the institution once; a re-run adds nothing; old or future cases and other workspaces
// stay quiet.
import { schema, withWorkspace, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { addMember, newWorkspace } from '../__tests__/fixtures.ts';

import { scanPortfolioAlerts } from './alerts.ts';

const NOW = new Date('2026-11-01T00:00:00Z');
const cnrOf = (n: number) => `TNCH${String(n).padStart(12, '0')}`;
const deps = (tx: Transaction) => ({
  db: tx,
  enqueueDelivery: () => Promise.resolve(null),
  now: () => NOW,
});

async function world(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const advocate = await addMember(tx, workspaceId, 'advocate');
  const clerk = await addMember(tx, workspaceId, 'clerk');
  const portfolioId = await withWorkspace(tx, { workspaceId, userId: ownerId }, async (s) => {
    const [p] = await s
      .insert(schema.portfolio)
      .values({ workspaceId, name: 'Book', createdBy: ownerId })
      .returning({ id: schema.portfolio.id });
    return p?.id ?? '';
  });
  const add = (n: number, v: Partial<typeof schema.portfolioCase.$inferInsert>) =>
    inWorkspace(tx, workspaceId, (s) =>
      s.insert(schema.portfolioCase).values({ workspaceId, portfolioId, cnr: cnrOf(n), ...v }),
    );
  const notices = () => inWorkspace(tx, workspaceId, (s) => s.select().from(schema.notification));
  return { workspaceId, users: [ownerId, advocate, clerk], add, notices };
}

describe('scanPortfolioAlerts', () => {
  it('notifies every active member of a new adverse order and a missed date, once', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      await w.add(1, {
        lastAdverseOrderAt: new Date('2026-10-30T00:00:00Z'),
        lastAdverseOrderRef: 'ord-1',
      });
      await w.add(2, { nextDate: '2026-10-25' });
      // Quiet cases: an old adverse order, a future date, a date missed long ago, no data.
      await w.add(3, { lastAdverseOrderAt: new Date('2026-09-01T00:00:00Z') });
      await w.add(4, { nextDate: '2026-11-10' });
      await w.add(5, { nextDate: '2026-08-01' });
      await w.add(6, {});
      const report = await scanPortfolioAlerts(deps(tx), w.workspaceId);
      expect(report).toEqual({ adverse: 1, missed: 1, notified: 6 });
      const rows = await w.notices();
      expect(rows).toHaveLength(6);
      expect([...new Set(rows.map((r) => r.userId))].sort()).toEqual([...w.users].sort());
      expect(rows.map((r) => r.category).sort()).toEqual([
        ...Array<string>(3).fill('portfolio.adverse_order'),
        ...Array<string>(3).fill('portfolio.missed_date'),
      ]);
      // A re-run notifies nobody twice.
      await scanPortfolioAlerts(deps(tx), w.workspaceId);
      expect(await w.notices()).toHaveLength(6);
      // A newer adverse order is a new alert.
      await inWorkspace(tx, w.workspaceId, (s) =>
        s.update(schema.portfolioCase).set({ lastAdverseOrderRef: 'ord-2' }),
      );
      await scanPortfolioAlerts(deps(tx), w.workspaceId);
      expect((await w.notices()).length).toBeGreaterThan(6);
    });
  });

  it('keeps another workspace quiet and refuses a malformed id', async () => {
    await withTestDb(async (tx) => {
      const a = await world(tx);
      const b = await world(tx);
      await a.add(1, { nextDate: '2026-10-25' });
      const report = await scanPortfolioAlerts(deps(tx), b.workspaceId);
      expect(report).toEqual({ adverse: 0, missed: 0, notified: 0 });
      expect(await b.notices()).toHaveLength(0);
      expect(await scanPortfolioAlerts(deps(tx), 'nope')).toEqual({
        adverse: 0,
        missed: 0,
        notified: 0,
      });
    });
  });

  it('lists only institution workspaces with cases as scan targets', async () => {
    await withTestDb(async (tx) => {
      const inst = await world(tx);
      const solo = await world(tx);
      const empty = await world(tx);
      await inst.add(1, {});
      await solo.add(1, {});
      await inWorkspace(tx, inst.workspaceId, (s) =>
        s
          .update(schema.organization)
          .set({ kind: 'institution' })
          .where(eq(schema.organization.id, inst.workspaceId)),
      );
      await inWorkspace(tx, empty.workspaceId, (s) =>
        s
          .update(schema.organization)
          .set({ kind: 'institution' })
          .where(eq(schema.organization.id, empty.workspaceId)),
      );
      const rows = await tx.execute<{ workspace_id: string }>(
        sql`select workspace_id::text from app_portfolio_alert_targets()`,
      );
      const ids = rows.map((r) => r.workspace_id);
      expect(ids).toContain(inst.workspaceId);
      expect(ids).not.toContain(solo.workspaceId);
      expect(ids).not.toContain(empty.workspaceId);
    });
  });
});
