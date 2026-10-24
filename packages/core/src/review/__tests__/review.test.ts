// The review and correction queue against the database (#518): a report needs consent, reaches the
// queue, and its fix reaches every workspace watching the record and no other; a reviewer sees one
// item's record and the read is audited; a fixed item becomes a fixture with one action.
import { schema, type Transaction } from '@causedeck/db';
import { closeTestDb, inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  assignReviewItem,
  enqueueReviewSignal,
  getReviewItem,
  listReviewCorrections,
  listReviewItems,
  markFixtureExported,
  reportRecordError,
  resolveReviewItem,
} from '../index.ts';

afterAll(closeTestDb);

const NOW = new Date('2026-10-24T09:00:00Z');

async function newUser(tx: Transaction, label: string): Promise<string> {
  const [row] = await tx
    .insert(schema.user)
    .values({ name: label, email: `${label}-${crypto.randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (row === undefined) throw new Error('user not created');
  return row.id;
}

async function setup(tx: Transaction) {
  const t = await seedTwoTenants(tx);
  const staffId = await newUser(tx, 'reviewer');
  await tx.insert(schema.staffUser).values({ userId: staffId, role: 'ops' });
  const watchOf = (ws: TwoTenants['a']) =>
    inWorkspace(tx, ws.id, (s) =>
      s.select().from(schema.caseWatch).where(eq(schema.caseWatch.workspaceId, ws.id)),
    ).then((rows) => rows[0]);
  const a = await watchOf(t.a);
  const b = await watchOf(t.b);
  if (a === undefined || b === undefined) throw new Error('seed watches');
  return { t, staff: { userId: staffId, role: 'ops' }, a, b };
}

const report = (proceedingId: string, consent = true) => ({
  proceedingId,
  field: 'next_date' as const,
  shownValue: '2026-11-02',
  reportedValue: '2026-11-09',
  consent,
});

describe('review queue', () => {
  it('refuses a report without consent', async () => {
    await withTestDb(async (tx) => {
      const { t, a } = await setup(tx);
      await expect(
        reportRecordError(tx, { userId: t.ua, workspaceId: t.a.id }, report(a.proceedingId, false)),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  it('refuses a report about a case the workspace does not watch', async () => {
    await withTestDb(async (tx) => {
      const { t, a } = await setup(tx);
      await expect(
        reportRecordError(tx, { userId: t.ub, workspaceId: t.b.id }, report(a.proceedingId)),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('puts a report in the queue with an SLA, and its fix reaches every watcher but no other', async () => {
    await withTestDb(async (tx) => {
      const { t, staff, a, b } = await setup(tx);
      const { id } = await reportRecordError(
        tx,
        { userId: t.ua, workspaceId: t.a.id },
        report(a.proceedingId),
        NOW,
      );
      const queue = await listReviewItems(tx, { now: NOW });
      const item = queue.find((q) => q.id === id);
      expect(item).toMatchObject({ kind: 'user_report', status: 'open', overdue: false });
      expect(item?.dueAt.getTime()).toBe(NOW.getTime() + 24 * 3_600_000);
      // The list carries no record values.
      expect(JSON.stringify(item)).not.toContain('2026-11-09');

      await assignReviewItem(tx, staff, id, staff.userId);
      const result = await resolveReviewItem(tx, staff, id, { correctedValue: '2026-11-09' }, NOW);
      expect(result.propagated).toBe(2);

      for (const [ws, watch] of [
        [t.a, a],
        [t.b, b],
      ] as const) {
        const rows = await inWorkspace(tx, ws.id, (s) =>
          listReviewCorrections(s, ws.id, watch.proceedingId),
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          field: 'next_date',
          value: '2026-11-09',
          reviewItemId: id,
        });
        const [raw] = await inWorkspace(tx, ws.id, (s) =>
          s
            .select()
            .from(schema.reviewCorrection)
            .where(eq(schema.reviewCorrection.reviewItemId, id)),
        );
        expect(raw).toMatchObject({
          sourceType: 'system',
          sourceRef: `causedeck-review:${id}`,
          confirmationState: 'corrected',
        });
      }

      // A workspace that does not watch the record gets nothing.
      const other = await seedOtherWatcherFree(tx);
      expect(
        await inWorkspace(tx, other.workspaceId, (s) =>
          s
            .select()
            .from(schema.reviewCorrection)
            .where(eq(schema.reviewCorrection.reviewItemId, id)),
        ),
      ).toHaveLength(0);

      // A fix is final.
      await expect(
        resolveReviewItem(tx, staff, id, { correctedValue: 'again' }, NOW),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  it('dedups a source-level signal while one is open and keeps it content-free', async () => {
    await withTestDb(async (tx) => {
      const first = await enqueueReviewSignal(
        tx,
        { kind: 'low_confidence', sourceId: 'test.sig', detail: 'parse yield 41%' },
        NOW,
      );
      const second = await enqueueReviewSignal(
        tx,
        { kind: 'low_confidence', sourceId: 'test.sig', detail: 'parse yield 40%' },
        NOW,
      );
      expect(first.created).toBe(true);
      expect(second).toEqual({ id: null, created: false });
      const [row] = await tx
        .select()
        .from(schema.reviewItem)
        .where(eq(schema.reviewItem.sourceId, 'test.sig'));
      expect(row).toMatchObject({ cnr: null, field: null, shownValue: null, reportedValue: null });
    });
  });

  it('audits a reviewer read of an item and returns only that item', async () => {
    await withTestDb(async (tx) => {
      const { t, staff, a } = await setup(tx);
      const one = await reportRecordError(
        tx,
        { userId: t.ua, workspaceId: t.a.id },
        report(a.proceedingId),
      );
      const two = await reportRecordError(
        tx,
        { userId: t.ua, workspaceId: t.a.id },
        report(a.proceedingId),
      );
      const item = await getReviewItem(tx, staff, one.id);
      expect(item.id).toBe(one.id);
      expect(item.id).not.toBe(two.id);
      const events = await tx
        .select()
        .from(schema.auditEvent)
        .where(
          and(eq(schema.auditEvent.action, 'staff.read'), eq(schema.auditEvent.targetId, one.id)),
        );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ actorUserId: staff.userId, actorKind: 'staff' });
      // Ids only: no record value reaches the audit metadata.
      expect(JSON.stringify(events[0]?.metadata)).not.toContain('2026-11-09');
    });
  });

  it('turns a fixed item into a fixture with one action, and only a fixed item', async () => {
    await withTestDb(async (tx) => {
      const { t, staff, a } = await setup(tx);
      const { id } = await reportRecordError(
        tx,
        { userId: t.ua, workspaceId: t.a.id },
        report(a.proceedingId),
      );
      await expect(markFixtureExported(tx, staff, id, NOW)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      await resolveReviewItem(tx, staff, id, { correctedValue: '2026-11-09' }, NOW);
      await markFixtureExported(tx, staff, id, NOW);
      const item = await getReviewItem(tx, staff, id);
      expect(item.fixtureExportedAt?.getTime()).toBe(NOW.getTime());
    });
  });
});

/** A workspace with no case watch: the control that a fix does not reach non-watchers. */
async function seedOtherWatcherFree(tx: Transaction): Promise<{ workspaceId: string }> {
  await newUser(tx, 'nowatch');
  const [org] = await tx
    .insert(schema.organization)
    .values({ name: 'No watch', slug: `nw-${crypto.randomUUID().slice(0, 8)}` })
    .returning({ id: schema.organization.id });
  if (org === undefined) throw new Error('org not created');
  return { workspaceId: org.id };
}
