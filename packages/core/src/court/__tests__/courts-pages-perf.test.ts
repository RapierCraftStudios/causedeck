// Courts pages render budget (#427, AC of #42): with two years of daily parse runs for four forums,
// the courts index and a forum's detail page (its default Halls tab) read their data in under
// 300 ms at p95.
//
// As rosters-perf.test.ts does, the always-on gate measures Postgres execution time (`EXPLAIN
// (ANALYZE, FORMAT JSON)` runs the statement for real) of the statements each page's read models
// issue, summed per page, after a warmup; wall-clock time on the shared, loaded build host measures
// the host as much as the code. The pages' read-model compositions run for every sample too, and
// their wall-clock p95 is asserted with MATTER_GRAPH_PERF_GATE=1 on a quiet runner. The parse-run
// reads are checked on the plan with sequential scans disabled: never a Seq Scan on
// `adapter_parse_run`.
//
// Index page (`/w/[slug]/courts/page.tsx`): getCourtsIndex. Detail page
// (`/w/[slug]/courts/[code]/layout.tsx` and `halls/page.tsx`): getForumDetail, getCourtsIndex and
// listHallsSeen.
import { performance } from 'node:perf_hooks';

import { Secret } from '@causedeck/config/env';
import type { Transaction } from '@causedeck/db';
import { createDb, inWorkspace, testDatabaseUrls, withTestDb } from '@causedeck/db/testing';
import { seedForumCatalogue } from '@causedeck/db/seed/forum-catalogue';
import { buildDocument, buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { sql, type SQLWrapper } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { getForumStatement, listForumsStatement } from '../forums.ts';
import {
  getCourtsIndex,
  getForumDetail,
  hallsSeenStatement,
  latestParseRunsStatement,
  listHallsSeen,
} from '../read-models.ts';

const ORIGINAL = 'in.tn.madras-hc.principal.original';
const APPELLATE = 'in.tn.madras-hc.principal.appellate';
const CUSTOM_FORUMS = 10;
/** Daily runs per forum with runs: two years. */
const RUNS = 730;
const HALLS = 30;
const UNREADABLE = ['7', '12'];
const WARMUP = 5;
const SAMPLES = 30;
const BUDGET_MS = 300;
// eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
const WALL_CLOCK_GATE = process.env.MATTER_GRAPH_PERF_GATE === '1';

const owner = createDb({ url: new Secret(testDatabaseUrls().owner), role: 'owner', max: 1 });

beforeAll(async () => {
  // Committed, as `pnpm db:migrate` leaves it.
  await seedForumCatalogue(owner);
});

afterAll(async () => {
  await owner.$client.end();
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

const NEWEST = new Date(Date.UTC(2024, 10, 1, 4) + (RUNS - 1) * 86_400_000);

/** A workspace with custom forums and `RUNS` daily parse runs for two catalogue and two custom forums. */
async function seedWorkspace(tx: Transaction) {
  const { workspaceId } = await newWorkspace(tx);
  return inWorkspace(tx, workspaceId, async (s) => {
    const custom = [];
    for (let i = 0; i < CUSTOM_FORUMS; i++) custom.push(await buildForum(s, workspaceId));
    const doc = await buildDocument(s, workspaceId);
    const forums = [
      [ORIGINAL, 'in.tn.madras-hc.principal'],
      [APPELLATE, 'in.tn.madras-hc.principal'],
      [custom[0]?.code ?? '', 'echo'],
      [custom[1]?.code ?? '', 'echo'],
    ] as const;
    const unreadable = sql.raw(`'{${UNREADABLE.join(',')}}'::text[]`);
    for (const [forumCode, adapterId] of forums) {
      // Every run names halls 1-30; the newest could not read halls 7 and 12.
      await s.execute(sql`
        insert into adapter_parse_run (workspace_id, document_id, adapter_id, adapter_version,
          forum_code, rows_parsed, rows_anchored, unmapped_headings, unknown_case_types,
          halls_seen, halls_unreadable, status, created_at)
        select ${workspaceId}::uuid, ${doc.id}::uuid, ${adapterId}, '1.0.0', ${forumCode}, 40, 38, 0, 0,
          case when g = ${RUNS}
            then array(select h::text from generate_series(1, ${HALLS}) h where h::text <> all (${unreadable}))
            else array(select h::text from generate_series(1, ${HALLS}) h) end,
          case when g = ${RUNS} then ${unreadable} else '{}'::text[] end,
          (case when g % 10 = 0 then 'degraded' when g % 25 = 0 then 'failed' else 'ok' end)::parse_health_status,
          timestamptz '2024-11-01 04:00:00+00' + (g - 1) * interval '1 day'
        from generate_series(1, ${RUNS}) as g`);
    }
    return { workspaceId };
  });
}

async function seed(tx: Transaction) {
  const d = await seedWorkspace(tx);
  // Noise: another workspace with the same volume, which RLS has to keep out.
  await seedWorkspace(tx);
  await tx.execute(sql`analyze adapter_parse_run`);
  await tx.execute(sql`analyze forum`);
  return d;
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

describe(`courts pages with ${String(RUNS)} daily parse runs for 4 forums (#427)`, () => {
  it('read parse runs through an index', { timeout: 300_000 }, async () => {
    await withTestDb(async (tx) => {
      const d = await seed(tx);
      await inWorkspace(tx, d.workspaceId, async (s) => {
        await s.execute(sql`set local enable_seqscan = off`);
        for (const statement of [latestParseRunsStatement(s), hallsSeenStatement(s, ORIGINAL)]) {
          const nodes = await planOf(s, statement);
          const seqScans = nodes.filter(
            (n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'adapter_parse_run',
          );
          expect(seqScans).toEqual([]);
          const indexes = nodes.flatMap((n) =>
            n['Index Name'] === undefined ? [] : [n['Index Name']],
          );
          expect(indexes.some((name) => name.startsWith('adapter_parse_run_'))).toBe(true);
        }
        await s.execute(sql`set local enable_seqscan = on`);
      });
    });
  });

  it(`render under ${String(BUDGET_MS)} ms`, { timeout: 300_000 }, async () => {
    await withTestDb(async (tx) => {
      const d = await seed(tx);
      await inWorkspace(tx, d.workspaceId, async (s) => {
        const indexExec: number[] = [];
        const detailExec: number[] = [];
        const indexWall: number[] = [];
        const detailWall: number[] = [];
        const indexStatements = () => [
          listForumsStatement(s, { includeDisabled: true }),
          latestParseRunsStatement(s),
        ];
        for (let i = 0; i < WARMUP + SAMPLES; i++) {
          let started = performance.now();
          const index = await getCourtsIndex(s, d.workspaceId);
          const indexElapsed = performance.now() - started;

          started = performance.now();
          const detail = await getForumDetail(s, d.workspaceId, ORIGINAL);
          await getCourtsIndex(s, d.workspaceId);
          const halls = await listHallsSeen(s, d.workspaceId, ORIGINAL);
          const detailElapsed = performance.now() - started;

          const indexMs = await executionMs(s, indexStatements());
          const detailMs = await executionMs(s, [
            getForumStatement(s, ORIGINAL),
            ...indexStatements(),
            hallsSeenStatement(s, ORIGINAL),
          ]);

          const forums = index.cities.flatMap((city) => city.courts.flatMap((c) => c.forums));
          expect(forums.filter((f) => f.workspaceOwned)).toHaveLength(CUSTOM_FORUMS);
          const original = forums.find((f) => f.code === ORIGINAL);
          expect(original?.latestParse).toEqual({
            status: 'degraded',
            at: NEWEST,
            hallsUnreadable: UNREADABLE,
          });
          expect(detail.forum.code).toBe(ORIGINAL);
          expect(halls).toHaveLength(HALLS);
          expect(halls.filter((h) => h.unreadable).map((h) => h.hallNo)).toEqual(UNREADABLE);
          if (i >= WARMUP) {
            indexExec.push(indexMs);
            detailExec.push(detailMs);
            indexWall.push(indexElapsed);
            detailWall.push(detailElapsed);
          }
        }
        expect(p95(indexExec), 'courts index execution p95').toBeLessThan(BUDGET_MS);
        expect(p95(detailExec), 'forum detail execution p95').toBeLessThan(BUDGET_MS);
        if (WALL_CLOCK_GATE) {
          expect(p95(indexWall), 'courts index wall-clock p95').toBeLessThan(BUDGET_MS);
          expect(p95(detailWall), 'forum detail wall-clock p95').toBeLessThan(BUDGET_MS);
        }
      });
    });
  });
});
