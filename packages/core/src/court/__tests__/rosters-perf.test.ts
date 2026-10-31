// Roster lookup budget (#387, AC of #39): with 40 rosters of 60 entries, `getRosterAt` and
// `resolveBenchForHall` are index-backed and run under 20 ms.
//
// As timeline-perf.test.ts does, the always-on gate measures Postgres execution time (`EXPLAIN
// (ANALYZE, FORMAT JSON)` runs the statement for real) of the statements the services issue, after
// a warmup; wall-clock time on the shared, loaded build host measures the host as much as the code.
// The services run for every sample too, and their wall-clock p95 is asserted with
// MATTER_GRAPH_PERF_GATE=1 on a quiet runner. "Index-backed" is checked on the plan with sequential
// scans disabled: the roster tables are reached through their indexes, never a Seq Scan.
import { performance } from 'node:perf_hooks';

import type { Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildBench, buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import {
  benchForHallStatement,
  getRosterAt,
  resolveBenchForHall,
  rosterAtStatement,
} from '../rosters.ts';

const ROSTERS = 40;
const ENTRIES = 60;
const WARMUP = 5;
const SAMPLES = 30;
const BUDGET_MS = 20;
// eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
const WALL_CLOCK_GATE = process.env.MATTER_GRAPH_PERF_GATE === '1';
const ROSTER_TABLES = new Set(['bench_roster', 'bench_roster_entry']);

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

/** Roster `i` (0-based) starts 28 days after roster `i - 1`; the last one is active, open-ended. */
const startOf = (i: number) => {
  const day = new Date(Date.UTC(2023, 0, 2 + i * 28));
  return day.toISOString().slice(0, 10);
};

async function seed(tx: Transaction) {
  const { workspaceId } = await newWorkspace(tx);
  return inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    // Noise: another forum with the same shape, so the forum filter has to select.
    const other = await buildForum(s, workspaceId);
    const forumBench = await buildBench(s, workspaceId, { forumId: forum.id });
    const otherBench = await buildBench(s, workspaceId, { forumId: other.id });
    const ws = sql`${workspaceId}::uuid`;
    for (const [forumId, benchId] of [
      [forum.id, forumBench.id],
      [other.id, otherBench.id],
    ] as const) {
      await s.execute(sql`
        insert into bench_roster (workspace_id, forum_id, effective_from, effective_to, status, version, confirmation_state)
        select ${ws}, ${forumId}::uuid,
          date '2023-01-02' + (g - 1) * 28,
          case when g = ${ROSTERS} then null else date '2023-01-02' + g * 28 end,
          case when g = ${ROSTERS} then 'active' else 'superseded' end,
          g, 'confirmed'
        from generate_series(1, ${ROSTERS}) as g`);
      await s.execute(sql`
        insert into bench_roster_entry (workspace_id, roster_id, hall_no, bench_id, portfolio_text)
        select ${ws}, r.id, h::text, ${benchId}::uuid, 'Portfolio ' || h
        from bench_roster r, generate_series(1, ${ENTRIES}) as h
        where r.workspace_id = ${ws} and r.forum_id = ${forumId}::uuid`);
    }
    await s.execute(sql`analyze bench_roster`);
    await s.execute(sql`analyze bench_roster_entry`);
    return { workspaceId, forumId: forum.id };
  });
}

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function nodesOf(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(nodesOf)];
}

async function planOf(s: Transaction, statement: SQLWrapper): Promise<PlanNode[]> {
  const [row] = await s.execute<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
    sql`explain (format json) ${statement.getSQL()}`,
  );
  const plan = row?.['QUERY PLAN'][0].Plan;
  if (plan === undefined) throw new Error('no plan');
  return nodesOf(plan);
}

async function executionMs(s: Transaction, statement: SQLWrapper): Promise<number> {
  const [plan] = await s.execute<{ 'QUERY PLAN': [{ 'Execution Time': number }] }>(
    sql`explain (analyze, format json) ${statement.getSQL()}`,
  );
  return plan?.['QUERY PLAN'][0]['Execution Time'] ?? Number.POSITIVE_INFINITY;
}

describe(`roster lookups with ${String(ROSTERS)} rosters of ${String(ENTRIES)} entries (#387)`, () => {
  it('are index-backed', { timeout: 300_000 }, async () => {
    await withTestDb(async (tx) => {
      const d = await seed(tx);
      await inWorkspace(tx, d.workspaceId, async (s) => {
        await s.execute(sql`set local enable_seqscan = off`);
        const day = { forumId: d.forumId, on: startOf(17) };
        const rosterPlan = await planOf(s, rosterAtStatement(s, d.workspaceId, day));
        const benchPlan = await planOf(
          s,
          benchForHallStatement(s, d.workspaceId, { ...day, hallNo: '42' }),
        );
        for (const nodes of [rosterPlan, benchPlan]) {
          const seqScans = nodes.filter(
            (n) => n['Node Type'] === 'Seq Scan' && ROSTER_TABLES.has(n['Relation Name'] ?? ''),
          );
          expect(seqScans).toEqual([]);
        }
        const indexes = (nodes: PlanNode[]) =>
          nodes.flatMap((n) => (n['Index Name'] === undefined ? [] : [n['Index Name']]));
        expect(indexes(rosterPlan).some((name) => name.startsWith('bench_roster_'))).toBe(true);
        // Any index of the entry table proves the lookup is index-backed. Naming the one index
        // flaked: with seqscans off the planner may pick another equally valid one (#995).
        expect(indexes(benchPlan).some((name) => name.startsWith('bench_roster_entry_'))).toBe(
          true,
        );
        await s.execute(sql`set local enable_seqscan = on`);
      });
    });
  });

  it(`run under ${String(BUDGET_MS)} ms`, { timeout: 300_000 }, async () => {
    await withTestDb(async (tx) => {
      const d = await seed(tx);
      await inWorkspace(tx, d.workspaceId, async (s) => {
        const rosterExec: number[] = [];
        const benchExec: number[] = [];
        const wall: number[] = [];
        for (let i = 0; i < WARMUP + SAMPLES; i++) {
          // Historic days across the chain and the current, open-ended roster.
          const index = i % ROSTERS;
          const day = { forumId: d.forumId, on: startOf(index) };
          const hall = { ...day, hallNo: String((i % ENTRIES) + 1) };
          const started = performance.now();
          const roster = await getRosterAt(s, d.workspaceId, day);
          const bench = await resolveBenchForHall(s, d.workspaceId, hall);
          const elapsed = performance.now() - started;
          const rosterMs = await executionMs(s, rosterAtStatement(s, d.workspaceId, day));
          const benchMs = await executionMs(s, benchForHallStatement(s, d.workspaceId, hall));
          expect(roster?.roster.version).toBe(index + 1);
          expect(roster?.entries).toHaveLength(ENTRIES);
          expect(bench?.rosterId).toBe(roster?.roster.id);
          if (i >= WARMUP) {
            rosterExec.push(rosterMs);
            benchExec.push(benchMs);
            wall.push(elapsed);
          }
        }
        expect(p95(rosterExec), 'getRosterAt execution p95').toBeLessThan(BUDGET_MS);
        expect(p95(benchExec), 'resolveBenchForHall execution p95').toBeLessThan(BUDGET_MS);
        if (WALL_CLOCK_GATE) {
          // Both services together, so each one is under the budget too.
          expect(p95(wall), 'wall-clock p95').toBeLessThan(BUDGET_MS);
        }
      });
    });
  });
});
