// The usage meter (#219): ledger plus counter, idempotency, validation, IST periods and overhead.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { UsageKey } from '../keys.ts';
import { getUsage, increment, incrementSql } from '../meter.ts';
import { usagePeriod } from '../period.ts';

const { usageCounter, usageEvent } = schema;

async function workspace(tx: Transaction) {
  const { a } = await seedTwoTenants(tx);
  return a.id;
}

function ledger(tx: Transaction, workspaceId: string, key: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ amount: usageEvent.amount, idempotencyKey: usageEvent.idempotencyKey })
      .from(usageEvent)
      .where(and(eq(usageEvent.workspaceId, workspaceId), eq(usageEvent.key, key))),
  );
}

function counters(tx: Transaction, workspaceId: string, key: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select({ periodStart: usageCounter.periodStart, value: usageCounter.value })
      .from(usageCounter)
      .where(and(eq(usageCounter.workspaceId, workspaceId), eq(usageCounter.key, key)))
      .orderBy(usageCounter.periodStart),
  );
}

describe('usage meter: increment and getUsage', () => {
  it('writes one ledger row and adds to the period counter', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await workspace(tx);
      const ctx = { db: tx, workspaceId };
      expect(await getUsage(ctx, 'ai.spend_paise')).toBe(0);
      const first = await increment(ctx, 'ai.spend_paise', 120, {
        idempotencyKey: 'call-1',
        metadata: { ai_call_id: randomUUID() },
      });
      expect(first).toEqual({ applied: true, value: 120 });
      const second = await increment(ctx, 'ai.spend_paise', 30, { idempotencyKey: 'call-2' });
      expect(second).toEqual({ applied: true, value: 150 });
      expect(await getUsage(ctx, 'ai.spend_paise')).toBe(150);
      expect(await ledger(tx, workspaceId, 'ai.spend_paise')).toHaveLength(2);
      expect(await getUsage(ctx, 'ai.tokens_in')).toBe(0);
    });
  });

  it('does not double count a repeated idempotency key', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await workspace(tx);
      const ctx = { db: tx, workspaceId };
      await increment(ctx, 'ocr.pages', 5, { idempotencyKey: 'doc-1' });
      const again = await increment(ctx, 'ocr.pages', 5, { idempotencyKey: 'doc-1' });
      expect(again).toEqual({ applied: false, value: null });
      // The key is per workspace, not per usage key: reusing it for another key is a replay too.
      const other = await increment(ctx, 'stt.seconds', 9, { idempotencyKey: 'doc-1' });
      expect(other.applied).toBe(false);
      expect(await getUsage(ctx, 'ocr.pages')).toBe(5);
      expect(await getUsage(ctx, 'stt.seconds')).toBe(0);
      expect(await ledger(tx, workspaceId, 'ocr.pages')).toEqual([
        { amount: 5, idempotencyKey: 'doc-1' },
      ]);
    });
  });

  it('rejects bad input before writing anything', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await workspace(tx);
      const ctx = { db: tx, workspaceId };
      const bad: [string, number, string][] = [
        ['ai.unknown', 1, 'k1'],
        ['ai.spend_paise', 1.5, 'k2'],
        ['ai.spend_paise', -1, 'k3'],
        ['ai.spend_paise', Number.MAX_SAFE_INTEGER + 1, 'k4'],
        ['ai.spend_paise', 1, ''],
        ['ai.spend_paise', 1, 'x'.repeat(201)],
      ];
      for (const [key, amount, idempotencyKey] of bad) {
        await expect(
          increment(ctx, key as UsageKey, amount, { idempotencyKey }),
          `${key} ${String(amount)} ${idempotencyKey.slice(0, 8)}`,
        ).rejects.toThrow(TypeError);
      }
      await expect(getUsage(ctx, 'nope' as UsageKey)).rejects.toThrow(TypeError);
      expect(await ledger(tx, workspaceId, 'ai.spend_paise')).toEqual([]);
      expect(await counters(tx, workspaceId, 'ai.spend_paise')).toEqual([]);
    });
  });

  it('takes signed deltas on gauge keys', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await workspace(tx);
      const ctx = { db: tx, workspaceId };
      await increment(ctx, 'storage.bytes', 4096, { idempotencyKey: 'up-1' });
      const freed = await increment(ctx, 'storage.bytes', -1024, { idempotencyKey: 'rm-1' });
      expect(freed).toEqual({ applied: true, value: 3072 });
      await increment(ctx, 'matters.active', 2, { idempotencyKey: 'm-open' });
      await increment(ctx, 'matters.active', -1, { idempotencyKey: 'm-close' });
      expect(await getUsage(ctx, 'matters.active')).toBe(1);
    });
  });

  it('counts by IST calendar month', async () => {
    await withTestDb(async (tx) => {
      const workspaceId = await workspace(tx);
      const lastMinuteOfMarch = new Date('2026-03-31T23:59:00+05:30');
      const firstOfApril = new Date('2026-04-01T00:00:00+05:30');
      const ctx = { db: tx, workspaceId, now: () => firstOfApril };
      await increment(ctx, 'ai.tokens_out', 7, { idempotencyKey: 'march', at: lastMinuteOfMarch });
      await increment(ctx, 'ai.tokens_out', 3, { idempotencyKey: 'april' });
      expect(await getUsage(ctx, 'ai.tokens_out', usagePeriod(lastMinuteOfMarch))).toBe(7);
      expect(await getUsage(ctx, 'ai.tokens_out')).toBe(3);
      const rows = await counters(tx, workspaceId, 'ai.tokens_out');
      expect(rows.map((r) => [r.periodStart.toISOString(), r.value])).toEqual([
        ['2026-02-28T18:30:00.000Z', 7],
        ['2026-03-31T18:30:00.000Z', 3],
      ]);
    });
  });

  it('keeps increment overhead p95 under 5 ms on seeded data', async () => {
    // The budget is the meter's own cost: the statement's execution time in Postgres (EXPLAIN
    // ANALYZE, which runs it for real), on a ledger seeded with 2,000 rows. Wall-clock time on a
    // shared test host is dominated by client round trips and load, so it is reported, not gated.
    await withTestDb(async (tx) => {
      const workspaceId = await workspace(tx);
      const ctx = { db: tx, workspaceId };
      await inWorkspace(tx, workspaceId, (s) =>
        s.execute(sql`
          insert into usage_event (workspace_id, key, amount, idempotency_key)
          select ${workspaceId}::uuid, 'ai.spend_paise', 1, 'seed-' || g
          from generate_series(1, 2000) as g`),
      );
      const p95 = (t: number[]) =>
        [...t].sort((x, y) => x - y)[Math.ceil(t.length * 0.95) - 1] ?? Infinity;
      const run = (i: number) =>
        inWorkspace(tx, workspaceId, async (s) => {
          const [plan] = await s.execute<{ 'QUERY PLAN': [{ 'Execution Time': number }] }>(
            sql`explain (analyze, format json) ${incrementSql({
              workspaceId,
              key: 'ai.spend_paise',
              amount: 1,
              idempotencyKey: `timed-${String(i)}`,
              at: new Date(),
            })}`,
          );
          return plan?.['QUERY PLAN'][0]['Execution Time'] ?? Infinity;
        });
      for (let i = 0; i < 20; i++) await run(-1 - i);
      const server: number[] = [];
      for (let i = 0; i < 200; i++) server.push(await run(i));
      expect(p95(server), `increment execution p95 ${p95(server).toFixed(2)} ms`).toBeLessThan(5);
      expect(await getUsage(ctx, 'ai.spend_paise')).toBe(220);

      const wall: number[] = [];
      for (let i = 0; i < 50; i++) {
        const started = performance.now();
        await increment(ctx, 'ai.spend_paise', 1, { idempotencyKey: `wall-${String(i)}` });
        wall.push(performance.now() - started);
      }
      console.info(
        `usage increment p95: execution ${p95(server).toFixed(2)} ms, wall ${p95(wall).toFixed(2)} ms`,
      );
    });
  });
});
