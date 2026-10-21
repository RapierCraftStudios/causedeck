// Matters list budget (#386; #40: list p95 server render < 300 ms on a seeded workspace of 500
// matters and 1,500 proceedings). The workspace holds both synthetic sets (Chennai solo and
// Bengaluru chamber, @causedeck/db/seed/synthetic) at their defaults.
//
// As perf.test.ts does, the always-on gate is the Postgres execution time (`EXPLAIN (ANALYZE,
// FORMAT JSON)`) of the list's first-page query (`searchMattersQuery`) for each sort and for a
// case-number and a party search; wall-clock time on the shared, loaded build host measures the
// host as much as the code. The service itself runs for every sample too, and its wall-clock p95
// is asserted with MATTER_GRAPH_PERF_GATE=1 on a quiet runner.
import { performance } from 'node:perf_hooks';

import { schema, type Transaction } from '@causedeck/db';
import {
  insertSyntheticMatterSet,
  SYNTHETIC_MARKETS,
  syntheticMatterSet,
} from '@causedeck/db/seed/synthetic';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { SearchMattersInput } from '@causedeck/validators/matter-graph-inputs';
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { searchMatters, type MatterGraphDeps } from '../../index.ts';
import { newWorkspace } from '../../__tests__/fixtures.ts';
import { searchMattersQuery, upcomingNextDates } from '../read-models.ts';

const TODAY = '2026-10-21';
const NOW = new Date(`${TODAY}T06:00:00Z`);
const WARMUP = 5;
const SAMPLES = 25;
const BUDGET_MS = 300;
// eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
const WALL_CLOCK_GATE = process.env.MATTER_GRAPH_PERF_GATE === '1';

const CASES: Record<string, SearchMattersInput> = {
  'next date': { sort: 'next_date' },
  updated: { sort: 'updated' },
  title: { sort: 'title' },
  'no next date, sensitive': { noNextDate: true, sensitive: false },
  // Synthetic case numbers are `SYN-NNNN`, so this one scans every proceeding and finds none.
  'case number': { q: 'W.P. No. 0045 of 2023' },
  party: { q: 'Hosmane' },
};

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

async function executionMs(s: Transaction, statement: SQLWrapper): Promise<number> {
  const [plan] = await s.execute<{ 'QUERY PLAN': [{ 'Execution Time': number }] }>(
    sql`explain (analyze, format json) ${statement.getSQL()}`,
  );
  return plan?.['QUERY PLAN'][0]['Execution Time'] ?? Number.POSITIVE_INFINITY;
}

/** The statement `upcomingNextDates` runs, for EXPLAIN. */
function upcomingStatement(s: Transaction, workspaceId: string): SQLWrapper {
  return s
    .select({ matterId: schema.proceeding.matterId, date: sql<string>`min(${schema.listing.listDate})` })
    .from(schema.listing)
    .innerJoin(
      schema.proceeding,
      and(
        eq(schema.proceeding.workspaceId, schema.listing.workspaceId),
        eq(schema.proceeding.id, schema.listing.proceedingId),
      ),
    )
    .where(
      and(
        eq(schema.listing.workspaceId, workspaceId),
        eq(schema.listing.canonical, true),
        sql`${schema.listing.listDate} >= ${TODAY}::date`,
      ),
    )
    .groupBy(schema.proceeding.matterId);
}

describe(`matters list under ${String(BUDGET_MS)} ms p95 (500 matters, 1,500 proceedings)`, () => {
  it('keeps each list query within budget', { timeout: 900_000 }, async () => {
    await withTestDb(async (tx) => {
      const { ownerId, workspaceId } = await newWorkspace(tx);
      const forumIds = await inWorkspace(tx, workspaceId, async (s) => [
        (await buildForum(s, workspaceId)).id,
        (await buildForum(s, workspaceId, { court: 'High Court of Karnataka', seat: 'Bengaluru' }))
          .id,
      ]);
      for (const market of SYNTHETIC_MARKETS) {
        await insertSyntheticMatterSet(
          tx,
          syntheticMatterSet({ market, workspaceId, forumIds, today: TODAY }),
        );
      }
      await inWorkspace(tx, workspaceId, async (s) => {
        const [count] = await s.execute<{ matters: number; proceedings: number }>(
          sql`select (select count(*)::int from matter) as matters, (select count(*)::int from proceeding) as proceedings`,
        );
        expect(count).toEqual({ matters: 500, proceedings: 1500 });
        await s.execute(sql`analyze matter, proceeding, listing, person, role_edge`);

        const deps: MatterGraphDeps = { db: s, events: { emit: () => undefined }, now: () => NOW };
        const actor = { userId: ownerId, workspaceId };
        const resolved = { ...actor, role: 'owner' as const };
        for (const [name, input] of Object.entries(CASES)) {
          const data = SearchMattersInput.parse(input);
          const first = await searchMatters(deps, actor, input);
          if (name !== 'case number') expect(first.items.length, name).toBeGreaterThan(0);
          const wall: number[] = [];
          const execution: number[] = [];
          for (let i = 0; i < WARMUP + SAMPLES; i++) {
            const started = performance.now();
            await searchMatters(deps, actor, input);
            const elapsed = performance.now() - started;
            // Both statements of the page: the next dates, then the page itself.
            const ms =
              (await executionMs(s, upcomingStatement(s, workspaceId))) +
              (await executionMs(
                s,
                searchMattersQuery(s, resolved, {}, data, await upcomingNextDates(s, workspaceId, TODAY)),
              ));
            if (i >= WARMUP) {
              wall.push(elapsed);
              execution.push(ms);
            }
          }
          const executionP95 = p95(execution);
          console.info(
            `searchMatters ${name}: execution p95 ${executionP95.toFixed(1)} ms, wall p95 ${p95(wall).toFixed(1)} ms`,
          );
          expect(executionP95, `${name} execution p95 ${executionP95.toFixed(2)} ms`).toBeLessThan(
            BUDGET_MS,
          );
          if (WALL_CLOCK_GATE) {
            const wallP95 = p95(wall);
            expect(wallP95, `${name} wall-clock p95 ${wallP95.toFixed(2)} ms`).toBeLessThan(
              BUDGET_MS,
            );
          }
        }
      });
    });
  });
});
