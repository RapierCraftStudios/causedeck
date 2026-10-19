// `system.usage.rollup` (#222): the hourly rollup and month-end close into `usage_period_summary`
// under FORCE row-level security. The job has no workspace; it lists workspaces through
// `app_usage_rollup_targets`, closes finished IST months immutably, is idempotent on re-run and
// prunes summaries older than 13 months. Runs as causedeck_app in a rolled-back transaction.
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { Logger } from '@causedeck/observability';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { periodStart } from '../../usage/period.ts';
import { registry } from '../registry.ts';
import { runUsageRollup, USAGE_SUMMARY_RETENTION_MONTHS, usageRollup } from './usage-rollup.ts';

const { organization, usageCounter, usagePeriodSummary } = schema;

// 00:30 IST on 1 April 2026: March has just ended, April is open.
const NOW = new Date('2026-04-01T00:30:00+05:30');
const MARCH = new Date('2026-03-01T00:00:00+05:30');
const APRIL = new Date('2026-04-01T00:00:00+05:30');
// 13 IST months before April 2026 is March 2025: kept; February 2025 is pruned.
const CUTOFF = new Date('2025-03-01T00:00:00+05:30');
const BEFORE_CUTOFF = new Date('2025-02-01T00:00:00+05:30');

const KEY = 'ai.spend_paise';

async function newWorkspace(tx: Transaction): Promise<string> {
  const id = randomUUID();
  await inWorkspace(tx, id, (s) =>
    s.insert(organization).values({ id, name: 'Rollup', slug: `rollup-${id}` }),
  );
  return id;
}

async function setCounter(tx: Transaction, workspaceId: string, at: Date, value: number) {
  await inWorkspace(tx, workspaceId, (s) =>
    s
      .insert(usageCounter)
      .values({ workspaceId, key: KEY, periodStart: at, value })
      .onConflictDoUpdate({
        target: [usageCounter.workspaceId, usageCounter.key, usageCounter.periodStart],
        set: { value },
      }),
  );
}

function summaries(tx: Transaction, workspaceId: string) {
  return inWorkspace(tx, workspaceId, (s) =>
    s
      .select({
        workspaceId: usagePeriodSummary.workspaceId,
        periodStart: usagePeriodSummary.periodStart,
        value: usagePeriodSummary.value,
        closedAt: usagePeriodSummary.closedAt,
      })
      .from(usagePeriodSummary)
      .orderBy(usagePeriodSummary.periodStart),
  );
}

async function pgError(tx: Transaction, fn: (sp: Transaction) => Promise<unknown>) {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp);
    });
    return undefined;
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause;
    return (cause ?? (error as { code?: string })).code;
  }
}

function rollup(tx: Transaction, now: Date) {
  const info = vi.fn();
  const ctx = { db: tx, log: { info } as unknown as Logger };
  return { run: () => runUsageRollup(ctx, { now: () => now }), info };
}

describe('system.usage.rollup', () => {
  it('is registered as an hourly system job', () => {
    expect(registry.get('system.usage.rollup')).toBe(usageRollup);
    expect(usageRollup.schedule?.cron).toBe('15 * * * *');
    expect(usageRollup.schema.parse({})).toEqual({});
    expect(USAGE_SUMMARY_RETENTION_MONTHS).toBe(13);
    expect(periodStart(NOW)).toEqual(APRIL);
  });

  it('closes the finished month, keeps the open one open, per workspace', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      const b = await newWorkspace(tx);
      await setCounter(tx, a, MARCH, 100);
      await setCounter(tx, a, APRIL, 7);
      await setCounter(tx, b, MARCH, 40);

      const { run, info } = rollup(tx, NOW);
      const report = await run();
      expect(report.workspaces).toBeGreaterThanOrEqual(2);
      expect(report.closed).toBeGreaterThanOrEqual(2);
      expect(info).toHaveBeenCalledWith(report, 'usage rollup complete');

      expect(await summaries(tx, a)).toEqual([
        { workspaceId: a, periodStart: MARCH, value: 100, closedAt: NOW },
        { workspaceId: a, periodStart: APRIL, value: 7, closedAt: null },
      ]);
      expect(await summaries(tx, b)).toEqual([
        { workspaceId: b, periodStart: MARCH, value: 40, closedAt: NOW },
      ]);
    });
  });

  it('is idempotent and never rewrites a closed summary', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      await setCounter(tx, a, MARCH, 100);
      await setCounter(tx, a, APRIL, 7);

      await rollup(tx, NOW).run();
      const first = await summaries(tx, a);
      await rollup(tx, NOW).run();
      expect(await summaries(tx, a)).toEqual(first);

      // Late usage lands in both counters; only the open month's summary follows it.
      await setCounter(tx, a, MARCH, 150);
      await setCounter(tx, a, APRIL, 9);
      const later = new Date(NOW.getTime() + 60 * 60 * 1000);
      await rollup(tx, later).run();
      expect(await summaries(tx, a)).toEqual([
        { workspaceId: a, periodStart: MARCH, value: 100, closedAt: NOW },
        { workspaceId: a, periodStart: APRIL, value: 9, closedAt: null },
      ]);
    });
  });

  it('rejects any change to a closed summary from the app role', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      await setCounter(tx, a, MARCH, 100);
      await setCounter(tx, a, APRIL, 7);
      await rollup(tx, NOW).run();

      const row = (period: Date) =>
        and(eq(usagePeriodSummary.workspaceId, a), eq(usagePeriodSummary.periodStart, period));
      expect(
        await pgError(tx, (sp) =>
          inWorkspace(sp, a, (s) =>
            s.update(usagePeriodSummary).set({ value: 1 }).where(row(MARCH)),
          ),
        ),
      ).toBe('42501');
      expect(
        await pgError(tx, (sp) =>
          inWorkspace(sp, a, (s) =>
            s.update(usagePeriodSummary).set({ closedAt: null }).where(row(MARCH)),
          ),
        ),
      ).toBe('42501');
      expect(
        await pgError(tx, (sp) =>
          inWorkspace(sp, a, (s) => s.delete(usagePeriodSummary).where(row(MARCH))),
        ),
      ).toBe('42501');
      // The open month can still change.
      expect(
        await pgError(tx, (sp) =>
          inWorkspace(sp, a, (s) =>
            s.update(usagePeriodSummary).set({ value: 8 }).where(row(APRIL)),
          ),
        ),
      ).toBeUndefined();
      expect((await summaries(tx, a))[0]).toMatchObject({ value: 100, closedAt: NOW });

      // Deleting the workspace still cascades through closed summaries.
      await inWorkspace(tx, a, (s) => s.delete(organization).where(eq(organization.id, a)));
      expect(await summaries(tx, a)).toEqual([]);
    });
  });

  it('prunes summaries older than 13 months', async () => {
    await withTestDb(async (tx) => {
      const a = await newWorkspace(tx);
      await inWorkspace(tx, a, (s) =>
        s.insert(usagePeriodSummary).values([
          { workspaceId: a, key: KEY, periodStart: BEFORE_CUTOFF, value: 1, closedAt: CUTOFF },
          { workspaceId: a, key: KEY, periodStart: CUTOFF, value: 2, closedAt: CUTOFF },
        ]),
      );

      const report = await rollup(tx, NOW).run();
      expect(report.pruned).toBeGreaterThanOrEqual(1);
      expect((await summaries(tx, a)).map((r) => r.periodStart)).toEqual([CUTOFF]);
    });
  });

  it('lists and prunes only through definer functions the app role may run', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ name: string; app: boolean; definer: boolean }>(
        sql`select p.proname as name,
                   has_function_privilege('causedeck_app', p.oid, 'execute') as app,
                   p.prosecdef as definer
            from pg_proc p
            where p.proname in ('app_usage_rollup_targets', 'app_purge_usage_period_summaries')
            order by p.proname`,
      );
      expect(rows).toEqual([
        { name: 'app_purge_usage_period_summaries', app: true, definer: true },
        { name: 'app_usage_rollup_targets', app: true, definer: true },
      ]);
      const columns = await tx.execute<{ name: string }>(
        sql`select a.attname as name from pg_proc p, unnest(p.proargnames) with ordinality a(attname, n)
            where p.proname = 'app_usage_rollup_targets' order by a.n`,
      );
      expect(columns.map((c) => c.name)).toEqual(['since', 'workspace_id']);
    });
  });
});
