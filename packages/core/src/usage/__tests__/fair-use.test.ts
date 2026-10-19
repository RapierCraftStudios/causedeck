// Fair-use caps (#221, #30 part 4): Junior's active matters, monthly OCR pages and monthly STT
// seconds from entitlements, enforced by `assertWithinFairUse` with `FAIR_USE_EXCEEDED`.
import { schema, type Transaction } from '@causedeck/db';
import { seedPlans } from '@causedeck/db/seed/plans';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../audit/__tests__/fixtures.ts';
import { invalidateEntitlements } from '../../billing/entitlements.ts';
import { assertWithinFairUse, FairUseError } from '../fair-use.ts';
import { increment } from '../meter.ts';

const NOW = new Date('2026-04-10T06:30:00.000Z');
// 1 May 2026 00:00 IST.
const RESET = new Date('2026-04-30T18:30:00.000Z');

async function junior(tx: Transaction, now = NOW) {
  await seedPlans(tx);
  const { workspaceId } = await newWorkspace(tx);
  return { db: tx, workspaceId, now: () => now };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected FAIR_USE_EXCEEDED');
    },
    (e: unknown) => e,
  );
}

describe('assertWithinFairUse', () => {
  it('caps Junior OCR pages per month, with the reset date', async () => {
    await withTestDb(async (tx) => {
      const ctx = await junior(tx);
      await increment(ctx, 'ocr.pages', 190, { idempotencyKey: 'ocr-1' });
      await assertWithinFairUse(ctx, 'ocr.pages', 10);
      const error = await rejection(assertWithinFairUse(ctx, 'ocr.pages', 11));
      expect(error).toBeInstanceOf(FairUseError);
      expect(error).toMatchObject({
        code: 'FAIR_USE_EXCEEDED',
        key: 'ocr.pages',
        limit: 200,
        used: 190,
        requested: 11,
        resetAt: RESET,
      });
      expect((error as Error).message).toBe(
        "You have reached this month's OCR page limit on the Junior plan (200 pages). It resets on 1 May 2026.",
      );
    });
  });

  it('caps Junior STT at capture minutes * 60 seconds per month', async () => {
    await withTestDb(async (tx) => {
      const ctx = await junior(tx);
      await increment(ctx, 'stt.seconds', 300 * 60 - 30, { idempotencyKey: 'stt-1' });
      await assertWithinFairUse(ctx, 'stt.seconds', 30);
      const error = await rejection(assertWithinFairUse(ctx, 'stt.seconds', 31));
      expect(error).toMatchObject({ code: 'FAIR_USE_EXCEEDED', limit: 18_000, resetAt: RESET });
      expect((error as Error).message).toContain('300 minutes');
      expect((error as Error).message).toContain('1 May 2026');
    });
  });

  it('does not count the previous period', async () => {
    await withTestDb(async (tx) => {
      const ctx = await junior(tx);
      await increment(ctx, 'ocr.pages', 200, {
        idempotencyKey: 'march',
        at: new Date('2026-03-20T00:00:00.000Z'),
      });
      await assertWithinFairUse(ctx, 'ocr.pages', 200);
    });
  });

  it('caps Junior at 15 active matters from the caller count, with no reset', async () => {
    await withTestDb(async (tx) => {
      const ctx = await junior(tx);
      await assertWithinFairUse(ctx, 'matters.active', 1, { current: 14 });
      const error = await rejection(assertWithinFairUse(ctx, 'matters.active', 1, { current: 15 }));
      expect(error).toMatchObject({
        code: 'FAIR_USE_EXCEEDED',
        key: 'matters.active',
        limit: 15,
        used: 15,
        resetAt: null,
      });
      expect((error as Error).message).toContain('15 active matters');
      await expect(assertWithinFairUse(ctx, 'matters.active', 1)).rejects.toThrow(TypeError);
    });
  });

  it('rejects a non-positive amount', async () => {
    await withTestDb(async (tx) => {
      const ctx = await junior(tx);
      await expect(assertWithinFairUse(ctx, 'ocr.pages', 0)).rejects.toThrow(TypeError);
      await expect(assertWithinFairUse(ctx, 'ocr.pages', 1.5)).rejects.toThrow(TypeError);
    });
  });

  it('never blocks a paid plan', async () => {
    await withTestDb(async (tx) => {
      const ctx = await junior(tx);
      await inWorkspace(tx, ctx.workspaceId, (s) =>
        s.insert(schema.subscription).values({
          workspaceId: ctx.workspaceId,
          planId: 'advocate-monthly-1',
          status: 'active',
          seats: 1,
          provider: 'mock',
        }),
      );
      invalidateEntitlements(ctx.workspaceId);
      await increment(ctx, 'ocr.pages', 10_000, { idempotencyKey: 'big' });
      await assertWithinFairUse(ctx, 'ocr.pages', 10_000);
      await assertWithinFairUse(ctx, 'stt.seconds', 1_000_000);
      await assertWithinFairUse(ctx, 'matters.active', 1, { current: 500 });
      invalidateEntitlements(ctx.workspaceId);
    });
  });
});
