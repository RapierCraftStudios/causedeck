// Matter-graph write budget (#349, part 6 of #32): on a matter with 50 proceedings and 500 listings,
// inserting and updating listings and proceedings stays under 50 ms p95 on the Testcontainers
// database, backed by the `(workspace_id, matter_id)`, `(workspace_id, proceeding_id, date)` and
// `(workspace_id, date, hall_id)` indexes.
//
// The always-on gate measures the statement's execution time in Postgres (`EXPLAIN (ANALYZE, FORMAT
// JSON)` runs it for real, triggers and FK checks included) after a warmup, as meter.test.ts does:
// wall-clock time on the shared, loaded build host measures the host as much as the schema. The
// wall-clock gate runs with MATTER_GRAPH_PERF_GATE=1 on a quiet runner.
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Transaction } from '../client.ts';
import { listing } from '../schema/docket.ts';
import { proceeding } from '../schema/proceedings.ts';
import { inWorkspace, withTestDb } from '../testing/index.ts';
import { buildCourtHall, buildForum, buildMatter } from '../testing/matter-graph-fixtures.ts';
import { newWorkspace } from './rls/fixtures.ts';

const PROCEEDINGS = 50;
const LISTINGS_PER_PROCEEDING = 10;
const WARMUP = 20;
const SAMPLES = 200;
const BUDGET_MS = 50;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

interface Seeded {
  workspaceId: string;
  matterId: string;
  forumId: string;
  hallId: string;
  proceedingIds: string[];
  listingIds: string[];
}

/** One matter with 50 numbered W.P.s, each with 10 listings across dates and a hall. */
async function seed(s: Transaction, workspaceId: string): Promise<Seeded> {
  const f = await buildForum(s, workspaceId);
  const hall = await buildCourtHall(s, workspaceId, { forumId: f.id });
  const m = await buildMatter(s, workspaceId);
  const proceedings = await s.execute<{ id: string }>(sql`
    insert into proceeding (workspace_id, matter_id, forum_id, case_type_code, number, year, state, source_type)
    select ${workspaceId}::uuid, ${m.id}::uuid, ${f.id}::uuid, 'WP', (20000 + g)::text, 2026, 'numbered', 'manual'
    from generate_series(1, ${PROCEEDINGS}) as g
    returning id`);
  const listings = await s.execute<{ id: string }>(sql`
    insert into listing (workspace_id, proceeding_id, list_date, list_type, stage_raw, hall_id, canonical, source_type)
    select ${workspaceId}::uuid, p.id, date '2026-06-01' + (g * 7), 'daily', 'FOR ADMISSION', ${hall.id}::uuid,
           g = ${LISTINGS_PER_PROCEEDING}, 'manual'
    from (select id from proceeding where matter_id = ${m.id}::uuid) as p,
         generate_series(1, ${LISTINGS_PER_PROCEEDING}) as g
    returning id`);
  return {
    workspaceId,
    matterId: m.id,
    forumId: f.id,
    hallId: hall.id,
    proceedingIds: proceedings.map((r) => r.id),
    listingIds: listings.map((r) => r.id),
  };
}

/** The writes under budget: statement builders for sample `i` (a list runs in order as one write). */
function writes(
  s: Transaction,
  d: Seeded,
): Record<string, (i: number) => SQLWrapper | SQLWrapper[]> {
  const pick = <T>(list: T[], i: number): T => {
    const value = list[i % list.length];
    if (value === undefined) throw new Error('empty seed list');
    return value;
  };
  return {
    'insert listing': (i) =>
      s.insert(listing).values({
        workspaceId: d.workspaceId,
        proceedingId: pick(d.proceedingIds, i),
        listDate: '2027-01-04',
        listType: 'advance',
        stageRaw: 'FOR HEARING',
        hallId: d.hallId,
        sourceType: 'adapter',
        sourceRef: `cause-list:${String(i)}`,
      }),
    'update listing': (i) =>
      s
        .update(listing)
        .set({ stageRaw: 'PART HEARD', stageNorm: 'part_heard', itemNo: String(i) })
        .where(eq(listing.id, pick(d.listingIds, i * 7))),
    // The next-date flip: unset the canonical listing, then set another (one index, immediate).
    'flip canonical listing': (i) => {
      const proceedingId = pick(d.proceedingIds, i);
      return [
        s
          .update(listing)
          .set({ canonical: false })
          .where(and(eq(listing.proceedingId, proceedingId), eq(listing.canonical, true))),
        s
          .update(listing)
          .set({ canonical: true })
          .where(
            eq(
              listing.id,
              sql`(select id from listing where proceeding_id = ${proceedingId}::uuid
                   order by list_date offset ${i % LISTINGS_PER_PROCEEDING} limit 1)`,
            ),
          ),
      ];
    },
    'insert proceeding': (i) =>
      s.insert(proceeding).values({
        workspaceId: d.workspaceId,
        matterId: d.matterId,
        forumId: d.forumId,
        caseTypeCode: 'WMP',
        number: String(90000 + i),
        year: 2026,
        state: 'numbered',
        parentProceedingId: pick(d.proceedingIds, i),
        sourceType: 'manual',
      }),
    'update proceeding': (i) =>
      s
        .update(proceeding)
        .set({ titlePetitioner: `Petitioner ${String(i)}`, stateChangedAt: new Date() })
        .where(eq(proceeding.id, pick(d.proceedingIds, i))),
  };
}

async function executionMs(s: Transaction, write: SQLWrapper | SQLWrapper[]): Promise<number> {
  let total = 0;
  for (const statement of Array.isArray(write) ? write : [write]) {
    const [plan] = await s.execute<{ 'QUERY PLAN': [{ 'Execution Time': number }] }>(
      sql`explain (analyze, format json) ${statement.getSQL()}`,
    );
    total += plan?.['QUERY PLAN'][0]['Execution Time'] ?? Number.POSITIVE_INFINITY;
  }
  return total;
}

async function run(s: Transaction, write: SQLWrapper | SQLWrapper[]): Promise<void> {
  for (const statement of Array.isArray(write) ? write : [write])
    await s.execute(statement.getSQL());
}

describe('matter-graph write budget (50 proceedings, 500 listings)', () => {
  it('has the indexes the budget relies on', async () => {
    await withTestDb(async (tx) => {
      const rows = await tx.execute<{ name: string; def: string }>(sql`
        select indexname::text as name, indexdef as def from pg_indexes
        where schemaname = 'public' and indexname in (
          'proceeding_workspace_matter_idx',
          'listing_workspace_proceeding_date_idx',
          'listing_workspace_date_hall_idx')
        order by indexname`);
      expect(rows.map((r) => [r.name, r.def.replace(/^.* USING btree /, '')])).toEqual([
        ['listing_workspace_date_hall_idx', '(workspace_id, list_date, hall_id)'],
        ['listing_workspace_proceeding_date_idx', '(workspace_id, proceeding_id, list_date)'],
        ['proceeding_workspace_matter_idx', '(workspace_id, matter_id)'],
      ]);
    });
  });

  it(
    `keeps insert/update execution p95 under ${String(BUDGET_MS)} ms`,
    { timeout: 300_000 },
    async () => {
      await withTestDb(async (tx) => {
        const ws = await newWorkspace(tx);
        await inWorkspace(tx, ws.id, async (s) => {
          const d = await seed(s, ws.id);
          expect(d.proceedingIds).toHaveLength(PROCEEDINGS);
          expect(d.listingIds).toHaveLength(PROCEEDINGS * LISTINGS_PER_PROCEEDING);
          for (const [name, build] of Object.entries(writes(s, d))) {
            for (let i = 0; i < WARMUP; i++) await executionMs(s, build(SAMPLES + i));
            const samples: number[] = [];
            for (let i = 0; i < SAMPLES; i++) samples.push(await executionMs(s, build(i)));
            const value = p95(samples);
            expect(value, `${name} execution p95 ${value.toFixed(2)} ms`).toBeLessThan(BUDGET_MS);
          }
        });
      });
    },
  );

  // eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
  it.runIf(process.env.MATTER_GRAPH_PERF_GATE === '1')(
    `keeps insert/update wall-clock p95 under ${String(BUDGET_MS)} ms (MATTER_GRAPH_PERF_GATE=1)`,
    { timeout: 300_000 },
    async () => {
      await withTestDb(async (tx) => {
        const ws = await newWorkspace(tx);
        await inWorkspace(tx, ws.id, async (s) => {
          const d = await seed(s, ws.id);
          for (const [name, build] of Object.entries(writes(s, d))) {
            for (let i = 0; i < WARMUP; i++) await run(s, build(SAMPLES + i));
            const samples: number[] = [];
            for (let i = 0; i < SAMPLES; i++) {
              const statement = build(i);
              const started = performance.now();
              await run(s, statement);
              samples.push(performance.now() - started);
            }
            const value = p95(samples);
            expect(value, `${name} wall-clock p95 ${value.toFixed(2)} ms`).toBeLessThan(BUDGET_MS);
          }
        });
      });
    },
  );
});
