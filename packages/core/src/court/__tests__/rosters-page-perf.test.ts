// Rosters actions and page budget (#434, "p95 server action under 300 ms on seeded data" of #39 and
// #391): with 4 forums of 12 rosters of 60 entries and 200 proceedings with open bench-change
// alerts, the rosters page read model and the preview of a roster PDF run under 300 ms at p95, and
// so do a confirmation with its bench-change detection.
//
// As courts-pages-perf.test.ts and rosters-perf.test.ts do, the always-on gate measures Postgres
// execution time (`EXPLAIN (ANALYZE, FORMAT JSON)` runs the statement for real) of the statements
// `getRostersPage` issues, summed, plus the in-process parse of the preview, after a warmup;
// wall-clock time on the shared, loaded build host measures the host as much as the code. The
// services run for every sample too, and their wall-clock p95 (the page, the preview, and confirm
// plus detection) is asserted with MATTER_GRAPH_PERF_GATE=1 on a quiet runner.
import { performance } from 'node:perf_hooks';

import type { Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildBench, buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { madrasRosterPdf } from '../__fixtures__/rosters.ts';
import { detectBenchChanges } from '../bench-change.ts';
import {
  getRostersPage,
  openBenchAlertsStatement,
  rosterEntryCountsStatement,
  rostersPageRostersStatement,
} from '../read-models.ts';
import { previewRosterImport } from '../roster-import.ts';
import { confirmRosterImport } from '../rosters.ts';

const FORUMS = 4;
const ROSTERS = 12;
const ENTRIES = 60;
const PROCEEDINGS_PER_FORUM = 50;
const WARMUP = 5;
const SAMPLES = 30;
const BUDGET_MS = 300;
const ON = '2023-12-01';
// eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
const WALL_CLOCK_GATE = process.env.MATTER_GRAPH_PERF_GATE === '1';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

/** Roster `g` (1-based) starts 28 days after roster `g - 1` from 2 Jan 2023; the last is active. */
async function seed(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forums = await inWorkspace(tx, workspaceId, async (s) => {
    const ws = sql`${workspaceId}::uuid`;
    const out: { forumId: string; a: string; b: string }[] = [];
    for (let f = 0; f < FORUMS; f++) {
      const forum = await buildForum(s, workspaceId);
      const a = await buildBench(s, workspaceId, { forumId: forum.id, judges: ['Justice A'] });
      const b = await buildBench(s, workspaceId, { forumId: forum.id, judges: ['Justice B'] });
      await s.execute(sql`
        insert into bench_roster (workspace_id, forum_id, effective_from, effective_to, status, version, confirmation_state)
        select ${ws}, ${forum.id}::uuid,
          date '2023-01-02' + (g - 1) * 28,
          case when g = ${ROSTERS} then null else date '2023-01-02' + g * 28 end,
          case when g = ${ROSTERS} then 'active' else 'superseded' end,
          g, 'confirmed'
        from generate_series(1, ${ROSTERS}) as g`);
      await s.execute(sql`
        insert into bench_roster_entry (workspace_id, roster_id, hall_no, bench_id, portfolio_text)
        select ${ws}, r.id, h::text, case when h % 2 = 0 then ${a.id}::uuid else ${b.id}::uuid end,
          'Portfolio ' || h
        from bench_roster r, generate_series(1, ${ENTRIES}) as h
        where r.workspace_id = ${ws} and r.forum_id = ${forum.id}::uuid`);
      await s.execute(sql`
        with m as (
          insert into matter (workspace_id, title)
          select ${ws}, 'Matter ' || g from generate_series(1, ${PROCEEDINGS_PER_FORUM}) as g
          returning id
        )
        insert into proceeding (workspace_id, matter_id, forum_id, case_type_code, case_type_raw, source_type)
        select ${ws}, m.id, ${forum.id}::uuid, 'WP', 'W.P.', 'manual' from m`);
      await s.execute(sql`
        insert into bench_change_alert (workspace_id, proceeding_id, roster_id, old_bench_id, new_bench_id, reason)
        select ${ws}, p.id, r.id, ${a.id}::uuid, ${b.id}::uuid, 'hall'
        from proceeding p
        join bench_roster r on r.workspace_id = p.workspace_id and r.forum_id = p.forum_id and r.status = 'active'
        where p.workspace_id = ${ws} and p.forum_id = ${forum.id}::uuid`);
      out.push({ forumId: forum.id, a: a.id, b: b.id });
    }
    for (const table of [
      'bench_roster',
      'bench_roster_entry',
      'bench_change_alert',
      'proceeding',
    ]) {
      await s.execute(sql.raw(`analyze ${table}`));
    }
    return out;
  });
  return { ownerId, workspaceId, forums };
}

async function executionMs(s: Transaction, statements: SQLWrapper[]): Promise<number> {
  let total = 0;
  for (const statement of statements) {
    const [plan] = await s.execute<{ 'QUERY PLAN': [{ 'Execution Time': number }] }>(
      sql`explain (analyze, format json) ${statement.getSQL()}`,
    );
    total += plan?.['QUERY PLAN'][0]['Execution Time'] ?? Number.POSITIVE_INFINITY;
  }
  return total;
}

describe(`rosters page and actions with ${String(FORUMS)} forums of ${String(ROSTERS)} rosters (#434)`, () => {
  it(`run under ${String(BUDGET_MS)} ms`, { timeout: 600_000 }, async () => {
    await withTestDb(async (tx) => {
      const d = await seed(tx);
      const actor = { userId: d.ownerId, workspaceId: d.workspaceId };
      const pdf = await madrasRosterPdf();
      const forum = d.forums[0];
      if (forum === undefined) throw new Error('seed forums');
      const deps = { events: { emit: () => undefined }, enqueueDelivery: () => Promise.resolve() };
      const pageExec: number[] = [];
      const pageWall: number[] = [];
      const previewWall: number[] = [];
      const confirmWall: number[] = [];
      for (let i = 0; i < WARMUP + SAMPLES; i++) {
        let started = performance.now();
        const page = await getRostersPage(tx, actor, { on: ON });
        const pageElapsed = performance.now() - started;
        expect(page.forums).toHaveLength(FORUMS);
        expect(page.forums.every((g) => g.rosters.length >= ROSTERS)).toBe(true);
        expect(page.forums.flatMap((g) => g.rosters).every((r) => r.entryCount === ENTRIES)).toBe(
          true,
        );
        expect(page.alerts).toHaveLength(FORUMS * PROCEEDINGS_PER_FORUM);

        started = performance.now();
        const preview = await previewRosterImport(pdf, 'in.tn.madras-hc.principal.appellate');
        const previewElapsed = performance.now() - started;
        expect(preview.candidates.length).toBeGreaterThan(0);

        // Each sample confirms the forum's next roster (hall 1 swaps bench) and detects changes.
        const effectiveFrom = new Date(Date.UTC(2024, 0, 1 + i * 7)).toISOString().slice(0, 10);
        started = performance.now();
        const confirmed = await confirmRosterImport(tx, actor, {
          forumId: forum.forumId,
          effectiveFrom,
          entries: Array.from({ length: ENTRIES }, (_, h) => ({
            hallNo: String(h + 1),
            benchId: (h + i) % 2 === 0 ? forum.a : forum.b,
            portfolioText: '',
          })),
        });
        await detectBenchChanges(tx, actor, { rosterId: confirmed.roster.id }, deps);
        const confirmElapsed = performance.now() - started;

        const execMs = await inWorkspace(
          tx,
          d.workspaceId,
          (s) =>
            executionMs(s, [
              rostersPageRostersStatement(s, d.workspaceId),
              rosterEntryCountsStatement(s, d.workspaceId),
              openBenchAlertsStatement(s, { ...actor, role: 'owner' }, {}),
            ]),
          d.ownerId,
        );
        if (i >= WARMUP) {
          pageExec.push(execMs + previewElapsed);
          pageWall.push(pageElapsed);
          previewWall.push(previewElapsed);
          confirmWall.push(confirmElapsed);
        }
      }
      expect(p95(pageExec), 'rosters page execution + preview parse p95').toBeLessThan(BUDGET_MS);
      if (WALL_CLOCK_GATE) {
        expect(p95(pageWall), 'rosters page wall-clock p95').toBeLessThan(BUDGET_MS);
        expect(p95(previewWall), 'preview wall-clock p95').toBeLessThan(BUDGET_MS);
        expect(p95(confirmWall), 'confirm + detection wall-clock p95').toBeLessThan(BUDGET_MS);
      }
    });
  });
});
