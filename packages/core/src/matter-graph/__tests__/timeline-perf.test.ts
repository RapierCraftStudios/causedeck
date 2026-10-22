// Matter timeline budget (#366, AC of #33): a 1,000-event matter returns in under 150 ms.
//
// As perf.test.ts does, the always-on gate measures Postgres execution time (`EXPLAIN (ANALYZE,
// FORMAT JSON)` runs each statement for real) of the selects the service issues, summed per call,
// after a warmup; wall-clock time on the shared, loaded build host measures the host as much as the
// code. The service itself runs for every sample too, and its wall-clock p95 is asserted with
// MATTER_GRAPH_PERF_GATE=1 on a quiet runner.
import { performance } from 'node:perf_hooks';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildDocument,
  buildForum,
  buildMatter,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { TIMELINE_EVENT_KINDS } from '@causedeck/validators/matter-graph-inputs';
import { and, eq, sql, type SQLWrapper } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getMatterTimeline, type MatterGraphDeps } from '../../index.ts';
import { newWorkspace } from '../../__tests__/fixtures.ts';
import { listingKeys, proceedingKeys, timelineStatements } from '../timeline.ts';

const PROCEEDINGS = 10;
/** Per proceeding: 30 listings, 30 hearings, 20 orders, 10 state changes (900); per matter: 50
 * due obligations, 25 closed ones and 25 documents (100). */
const EVENTS = 1000;
const WARMUP = 5;
const SAMPLES = 30;
const BUDGET_MS = 150;
// eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
const WALL_CLOCK_GATE = process.env.MATTER_GRAPH_PERF_GATE === '1';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

interface Seeded {
  workspaceId: string;
  ownerId: string;
  matterId: string;
  proceedingIds: string[];
}

async function seed(tx: Transaction): Promise<Seeded> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  return inWorkspace(tx, workspaceId, async (s) => {
    const forum = await buildForum(s, workspaceId);
    const m = await buildMatter(s, workspaceId);
    const other = await buildMatter(s, workspaceId);
    // The orders' source document belongs to no matter, so it adds no event itself.
    const doc = await buildDocument(s, workspaceId);
    const [owner] = await s
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, workspaceId), eq(schema.member.userId, ownerId)));
    const ws = sql`${workspaceId}::uuid`;
    const insertProceedings = (matterId: string, count: number, base: number) =>
      s.execute<{ id: string }>(sql`
        insert into proceeding (workspace_id, matter_id, forum_id, case_type_code, number, year, state, source_type)
        select ${ws}, ${matterId}::uuid, ${forum.id}::uuid, 'WP', (${base} + g)::text, 2026, 'numbered', 'manual'
        from generate_series(1, ${count}) as g
        returning id`);
    const proceedings = await insertProceedings(m.id, PROCEEDINGS, 30000);
    const noise = await insertProceedings(other.id, 5, 40000);
    const listingsOf = (matterId: string, perProceeding: number) =>
      s.execute(sql`
        insert into listing (workspace_id, proceeding_id, list_date, list_type, stage_raw, source_type)
        select ${ws}, p.id, date '2027-01-01' + g, 'daily', '', 'manual'
        from proceeding p, generate_series(1, ${perProceeding}) as g
        where p.workspace_id = ${ws} and p.matter_id = ${matterId}::uuid`);
    await listingsOf(m.id, 30);
    await listingsOf(other.id, 40);
    await s.execute(sql`
      insert into hearing (workspace_id, listing_id, held_on, source_type)
      select ${ws}, l.id, l.list_date, 'manual'
      from listing l join proceeding p on p.workspace_id = l.workspace_id and p.id = l.proceeding_id
      where l.workspace_id = ${ws} and p.matter_id = ${m.id}::uuid`);
    await s.execute(sql`
      insert into "order" (workspace_id, proceeding_id, document_id, order_date, order_type, source_type)
      select ${ws}, p.id, ${doc.id}::uuid, date '2027-01-01' + g, 'interim', 'manual'
      from proceeding p, generate_series(1, 20) as g
      where p.workspace_id = ${ws} and p.matter_id = ${m.id}::uuid`);
    await s.execute(sql`
      insert into proceeding_state_change (workspace_id, proceeding_id, from_state, to_state, changed_at, source_type, confirmation_state)
      select ${ws}, p.id,
        (case when g % 2 = 0 then 'defects' else 're_presented' end)::proceeding_state,
        (case when g % 2 = 0 then 're_presented' else 'defects' end)::proceeding_state,
        timestamptz '2026-12-01 10:00+05:30' + g * interval '1 day', 'manual', 'confirmed'
      from proceeding p, generate_series(1, 10) as g
      where p.workspace_id = ${ws} and p.matter_id = ${m.id}::uuid`);
    await s.execute(sql`
      insert into obligation (workspace_id, matter_id, source, description, due_date, source_type)
      select ${ws}, ${m.id}::uuid, 'order_direction', 'Due ' || g, date '2027-02-01' + g, 'manual'
      from generate_series(1, 50) as g`);
    await s.execute(sql`
      insert into obligation (workspace_id, matter_id, source, description, status, closed_reason_type, closed_by, closed_at, source_type)
      select ${ws}, ${m.id}::uuid, 'order_direction', 'Closed ' || g, 'done', 'lawyer_action',
        ${owner?.id ?? null}::uuid, timestamptz '2027-03-01 12:00+05:30' + g * interval '1 hour', 'manual'
      from generate_series(1, 25) as g`);
    await s.execute(sql`
      insert into obligation (workspace_id, matter_id, source, description, due_date, source_type)
      select ${ws}, ${other.id}::uuid, 'order_direction', 'Noise ' || g, date '2027-02-01' + g, 'manual'
      from generate_series(1, 50) as g`);
    await s.execute(sql`
      insert into document (workspace_id, matter_id, kind, storage_key, sha256)
      select ${ws}, mm.id, 'pleading', 'ws/' || ${workspaceId} || '/perf/' || mm.n || '-' || g, repeat('d', 64)
      from generate_series(1, 25) as g,
        (values (${m.id}::uuid, 'm'), (${other.id}::uuid, 'o')) as mm(id, n)`);
    expect(noise).toHaveLength(5);
    return { workspaceId, ownerId, matterId: m.id, proceedingIds: proceedings.map((r) => r.id) };
  });
}

async function executionMs(s: Transaction, statement: SQLWrapper): Promise<number> {
  const [plan] = await s.execute<{ 'QUERY PLAN': [{ 'Execution Time': number }] }>(
    sql`explain (analyze, format json) ${statement.getSQL()}`,
  );
  return plan?.['QUERY PLAN'][0]['Execution Time'] ?? Number.POSITIVE_INFINITY;
}

describe(`getMatterTimeline on a ${String(EVENTS)}-event matter under ${String(BUDGET_MS)} ms`, () => {
  it('keeps the timeline selects within budget', { timeout: 300_000 }, async () => {
    await withTestDb(async (tx) => {
      const d = await seed(tx);
      await inWorkspace(tx, d.workspaceId, async (s) => {
        const deps: MatterGraphDeps = { db: s, events: { emit: () => undefined } };
        const actor = { userId: d.ownerId, workspaceId: d.workspaceId };
        const listings = await listingKeys(s, d.workspaceId, d.proceedingIds);
        const statements: SQLWrapper[] = [
          proceedingKeys(s, d.workspaceId, d.matterId),
          listingKeys(s, d.workspaceId, d.proceedingIds),
          ...Object.values(
            timelineStatements(
              s,
              d.workspaceId,
              d.matterId,
              d.proceedingIds,
              listings.map((l) => l.id),
              { kinds: new Set(TIMELINE_EVENT_KINDS) },
            ),
          ).filter((q): q is NonNullable<typeof q> => q !== undefined),
        ];
        expect(statements).toHaveLength(9);
        const wall: number[] = [];
        const execution: number[] = [];
        for (let i = 0; i < WARMUP + SAMPLES; i++) {
          const started = performance.now();
          const timeline = await getMatterTimeline(deps, actor, { matterId: d.matterId });
          const elapsed = performance.now() - started;
          let ms = 0;
          for (const statement of statements) ms += await executionMs(s, statement);
          if (i === 0) {
            expect(timeline).toHaveLength(EVENTS);
            for (let k = 1; k < timeline.length; k++) {
              expect((timeline[k - 1]?.at ?? '') <= (timeline[k]?.at ?? '')).toBe(true);
            }
          }
          if (i >= WARMUP) {
            wall.push(elapsed);
            execution.push(ms);
          }
        }
        const executionP95 = p95(execution);
        expect(executionP95, `timeline execution p95 ${executionP95.toFixed(2)} ms`).toBeLessThan(
          BUDGET_MS,
        );
        if (WALL_CLOCK_GATE) {
          const wallP95 = p95(wall);
          expect(wallP95, `timeline wall-clock p95 ${wallP95.toFixed(2)} ms`).toBeLessThan(
            BUDGET_MS,
          );
        }
      });
    });
  });
});
