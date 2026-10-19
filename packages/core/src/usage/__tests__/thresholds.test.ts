// Usage thresholds (#221, #30 part 4): the 80% soft-limit notice to owners (once per IST period,
// in-app and email through billing.notice), the 100% hard limit with a courtesy grace, and the
// guarantee that the hard limit gates only new AI calls (no data hidden or deleted, nothing else
// blocked).
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { DeliveryJob } from '@causedeck/notifications';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newUser, newWorkspace } from '../../audit/__tests__/fixtures.ts';
import { getWorkspaceEntitlements } from '../../billing/entitlements.ts';
import { BudgetError, commit, reserve } from '../budget.ts';
import { USAGE_WARNING_EVENT, usageWarningDedupeKey } from '../events.ts';
import { getUsage, increment } from '../meter.ts';
import { usagePeriod } from '../period.ts';
import {
  checkAiBudgetThresholds,
  hardLimitPaise,
  resolveThresholds,
  usageLevel,
} from '../thresholds.ts';

const NOW = new Date('2026-03-10T06:30:00.000Z');
const NEXT_MONTH = new Date('2026-04-10T06:30:00.000Z');

describe('thresholds: pure', () => {
  it('classifies spend against the budget', () => {
    expect(usageLevel(799, 1_000)).toBe('ok');
    expect(usageLevel(7_999, 10_000)).toBe('ok');
    expect(usageLevel(800, 1_000)).toBe('warning');
    expect(usageLevel(999, 1_000)).toBe('warning');
    expect(usageLevel(1_000, 1_000)).toBe('exceeded');
    expect(usageLevel(1_000_000, null)).toBe('ok');
  });

  it('adds the courtesy grace to the hard limit, rounded down', () => {
    expect(hardLimitPaise(1_000, 0)).toBe(1_000);
    expect(hardLimitPaise(1_000, 1_000)).toBe(1_100);
    expect(hardLimitPaise(999, 1_000)).toBe(1_098);
  });

  it('defaults the grace to 0 and rejects an invalid one', () => {
    expect(resolveThresholds({})).toEqual({ courtesyGraceBps: 0 });
    expect(resolveThresholds({ thresholds: { courtesyGraceBps: 500 } })).toEqual({
      courtesyGraceBps: 500,
    });
    expect(() => resolveThresholds({ thresholds: { courtesyGraceBps: -1 } })).toThrow(TypeError);
    expect(() => resolveThresholds({ thresholds: { courtesyGraceBps: 1.5 } })).toThrow(TypeError);
  });

  it('keys the warning by metered key and period', () => {
    const a = usageWarningDedupeKey('ai.spend_paise', usagePeriod(NOW));
    expect(a).toBe(`${USAGE_WARNING_EVENT}:ai.spend_paise:2026-02-28T18:30:00.000Z`);
    expect(
      usageWarningDedupeKey('ai.spend_paise', usagePeriod(new Date('2026-03-30T00:00:00Z'))),
    ).toBe(a);
    expect(usageWarningDedupeKey('ai.spend_paise', usagePeriod(NEXT_MONTH))).not.toBe(a);
  });
});

/** A Junior workspace (budget 1_000 paise) with a second owner and a non-owner advocate. */
async function seed(tx: Transaction) {
  await seedPlans(tx);
  const { workspaceId, ownerId } = await newWorkspace(tx);
  const coOwnerId = await newUser(tx);
  const advocateId = await newUser(tx);
  await inWorkspace(tx, workspaceId, (s) =>
    s.insert(schema.member).values([
      { organizationId: workspaceId, userId: coOwnerId, role: 'owner' },
      { organizationId: workspaceId, userId: advocateId, role: 'advocate' },
    ]),
  );
  const deliveries: DeliveryJob[] = [];
  const enqueueDelivery = (job: DeliveryJob) => {
    deliveries.push(job);
    return Promise.resolve(null);
  };
  const ctxAt = (now: Date) => ({ db: tx, workspaceId, now: () => now, enqueueDelivery });
  return { workspaceId, ownerId, coOwnerId, advocateId, deliveries, enqueueDelivery, ctxAt };
}

function noticesOf(tx: Transaction, workspaceId: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select({
        id: schema.notification.id,
        userId: schema.notification.userId,
        category: schema.notification.category,
        title: schema.notification.title,
        href: schema.notification.href,
        dedupeKey: schema.notification.dedupeKey,
      })
      .from(schema.notification)
      .where(eq(schema.notification.workspaceId, workspaceId)),
  );
}

async function spend(ctx: Parameters<typeof reserve>[0], paise: number) {
  const r = await reserve(ctx, { estimatePaise: paise, purpose: 'brief.draft' });
  return commit(ctx, r, paise);
}

describe('thresholds: the 80% soft limit', () => {
  it('notifies each active owner once per period, in-app and by email', async () => {
    await withTestDb(async (tx) => {
      const ws = await seed(tx);
      const ctx = ws.ctxAt(NOW);

      await spend(ctx, 700);
      expect(await noticesOf(tx, ws.workspaceId)).toEqual([]);

      // Crossing 80%: one notice per owner, none for the advocate.
      expect(await spend(ctx, 150)).toEqual({ applied: true, value: 850 });
      const notices = await noticesOf(tx, ws.workspaceId);
      expect(notices.map((n) => n.userId).sort()).toEqual([ws.ownerId, ws.coOwnerId].sort());
      const dedupeKey = usageWarningDedupeKey('ai.spend_paise', usagePeriod(NOW));
      for (const n of notices) {
        expect(n).toMatchObject({
          category: 'billing.notice',
          title: "You have used 80% of this month's AI budget",
          dedupeKey,
        });
        expect(n.href).toMatch(/^\/w\/.+\/settings\/billing$/);
      }
      expect(ws.deliveries).toEqual(
        expect.arrayContaining(
          notices.map((n) => ({
            workspaceId: ws.workspaceId,
            notificationId: n.id,
            channel: 'email',
          })),
        ),
      );
      const delivered = ws.deliveries.length;

      // Further spend in the same period sends nothing more.
      await spend(ctx, 100);
      expect(await noticesOf(tx, ws.workspaceId)).toHaveLength(2);
      expect(ws.deliveries).toHaveLength(delivered);

      // The next IST period starts fresh and warns again.
      await spend(ws.ctxAt(NEXT_MONTH), 900);
      const after = await noticesOf(tx, ws.workspaceId);
      expect(after).toHaveLength(4);
      expect(after.filter((n) => n.dedupeKey !== dedupeKey)).toHaveLength(2);
    });
  });

  it('sends nothing below 80% and reports the level', async () => {
    await withTestDb(async (tx) => {
      const ws = await seed(tx);
      await increment(ws.ctxAt(NOW), 'ai.spend_paise', 799, { idempotencyKey: 'below' });
      expect(await checkAiBudgetThresholds(ws.ctxAt(NOW))).toEqual({
        level: 'ok',
        spentPaise: 799,
        budgetPaise: 1_000,
        notified: 0,
      });
      expect(await noticesOf(tx, ws.workspaceId)).toEqual([]);
    });
  });

  it('runs no notice code without enqueueDelivery', async () => {
    await withTestDb(async (tx) => {
      const ws = await seed(tx);
      const ctx = { db: tx, workspaceId: ws.workspaceId, now: () => NOW };
      await spend(ctx, 900);
      expect(await noticesOf(tx, ws.workspaceId)).toEqual([]);
    });
  });

  it('never fails the commit when the notice fails', async () => {
    await withTestDb(async (tx) => {
      const ws = await seed(tx);
      const ctx = {
        ...ws.ctxAt(NOW),
        enqueueDelivery: () => Promise.reject(new Error('queue down')),
      };
      expect(await spend(ctx, 900)).toEqual({ applied: true, value: 900 });
      expect(await getUsage(ctx, 'ai.spend_paise')).toBe(900);
    });
  });
});

describe('thresholds: the 100% hard limit', () => {
  it('blocks new AI calls only; data, metering and write access are untouched', async () => {
    await withTestDb(async (tx) => {
      const ws = await seed(tx);
      const ctx = ws.ctxAt(NOW);
      await increment(ctx, 'ocr.pages', 12, { idempotencyKey: 'ocr-before' });
      await spend(ctx, 1_000);
      const eventsBefore = await inWorkspace(tx, ws.workspaceId, (s) =>
        s.select().from(schema.usageEvent).where(eq(schema.usageEvent.workspaceId, ws.workspaceId)),
      );

      const error = await reserve(ctx, { estimatePaise: 1, purpose: 'brief.draft' }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(BudgetError);
      expect(error).toMatchObject({
        code: 'BUDGET_EXCEEDED',
        budgetPaise: 1_000,
        limitPaise: 1_000,
      });

      // Non-AI metering and reads keep working.
      await increment(ctx, 'ocr.pages', 3, { idempotencyKey: 'ocr-after' });
      await increment(ctx, 'stt.seconds', 60, { idempotencyKey: 'stt-after' });
      await increment(ctx, 'matters.active', 1, { idempotencyKey: 'matter-after' });
      expect(await getUsage(ctx, 'ocr.pages')).toBe(15);
      expect(await getUsage(ctx, 'ai.spend_paise')).toBe(1_000);

      // Nothing was deleted or hidden, and write access (manual entry, export) does not depend on AI spend.
      const eventsAfter = await inWorkspace(tx, ws.workspaceId, (s) =>
        s.select().from(schema.usageEvent).where(eq(schema.usageEvent.workspaceId, ws.workspaceId)),
      );
      expect(eventsAfter).toEqual(expect.arrayContaining(eventsBefore));
      expect(eventsAfter).toHaveLength(eventsBefore.length + 3);
      const entitlements = await inWorkspace(tx, ws.workspaceId, (s) =>
        getWorkspaceEntitlements(s, ws.workspaceId, NOW),
      );
      expect(entitlements.features.write).toBe(true);
      expect(entitlements.readOnly).toBe(false);
    });
  });

  it('allows the courtesy grace beyond the budget, and no further', async () => {
    await withTestDb(async (tx) => {
      const ws = await seed(tx);
      const ctx = { ...ws.ctxAt(NOW), thresholds: { courtesyGraceBps: 1_000 } };
      await spend(ctx, 1_000);
      await reserve(ctx, { estimatePaise: 100, purpose: 'brief.draft' });
      const error = await reserve(ctx, { estimatePaise: 1, purpose: 'brief.draft' }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toMatchObject({
        code: 'BUDGET_EXCEEDED',
        budgetPaise: 1_000,
        limitPaise: 1_100,
      });
    });
  });

  it('tells owners when the budget is used up', async () => {
    await withTestDb(async (tx) => {
      const ws = await seed(tx);
      await spend(ws.ctxAt(NOW), 1_000);
      const notices = await noticesOf(tx, ws.workspaceId);
      expect(notices).toHaveLength(2);
      expect(notices[0]?.title).toBe("You have used this month's AI budget");
    });
  });
});
