// Matter-graph service budget (#362, #363, AC of #33): p95 for each mutating service call stays
// under 100 ms on seeded data (a Chennai-solo graph plus a matter with 50 numbered and 50
// pre-numbering proceedings, the latter for the state machine).
//
// As packages/db/src/__tests__/matter-graph-perf.test.ts does, the always-on gate measures Postgres
// execution time (`EXPLAIN (ANALYZE, FORMAT JSON)` runs the statement for real, triggers and FK
// checks included) of the write each service issues, after a warmup; wall-clock time on the shared,
// loaded build host measures the host as much as the code. The services themselves run for every
// sample too, and their wall-clock p95 is asserted with MATTER_GRAPH_PERF_GATE=1 on a quiet runner.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildChennaiSoloGraph, buildMatter } from '@causedeck/db/testing/matter-graph-fixtures';
import { eq, sql, type SQLWrapper } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  archiveMatter,
  confirmNextDate,
  createDocument,
  createMatter,
  createProceeding,
  linkProceedings,
  proposeNextDate,
  transitionProceeding,
  updateIdentifiers,
  updateMatter,
  type MatterGraphDeps,
} from '../../index.ts';
import { newWorkspace } from '../../__tests__/fixtures.ts';

const PROCEEDINGS = 50;
/** Seeded proposed listings, one per confirmNextDate sample. */
const LISTINGS = 120;
const WARMUP = 20;
const SAMPLES = 100;
const BUDGET_MS = 100;
// eslint-disable-next-line no-process-env -- a test-runner switch, not app configuration.
const WALL_CLOCK_GATE = process.env.MATTER_GRAPH_PERF_GATE === '1';

const MANUAL = { sourceType: 'manual' } as const;

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

interface Seeded {
  workspaceId: string;
  ownerId: string;
  forumId: string;
  matterId: string;
  proceedingIds: string[];
  /** Pre-numbering proceedings in `defects`, cycled defects <-> re_presented (#363). */
  defectIds: string[];
  listingIds: string[];
}

async function seed(tx: Transaction): Promise<Seeded> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  return inWorkspace(tx, workspaceId, async (s) => {
    const graph = await buildChennaiSoloGraph(s, workspaceId);
    const m = await buildMatter(s, workspaceId);
    const rows = await s.execute<{ id: string }>(sql`
      insert into proceeding (workspace_id, matter_id, forum_id, case_type_code, number, year, state, source_type)
      select ${workspaceId}::uuid, ${m.id}::uuid, ${graph.forumId}::uuid, 'WP', (20000 + g)::text, 2026, 'numbered', 'manual'
      from generate_series(1, ${PROCEEDINGS}) as g
      returning id`);
    const proceedingIds = rows.map((r) => r.id);
    const listings = await s.execute<{ id: string }>(sql`
      insert into listing (workspace_id, proceeding_id, list_date, list_type, stage_raw, source_type)
      select ${workspaceId}::uuid, p.id, date '2027-06-01' + g, 'daily', '', 'manual'
      from generate_series(0, ${LISTINGS - 1}) as g
      join (
        select id, row_number() over (order by id) - 1 as n from proceeding
        where workspace_id = ${workspaceId}::uuid and matter_id = ${m.id}::uuid
      ) as p on p.n = g % ${PROCEEDINGS}
      returning id`);
    const defects = await s.execute<{ id: string }>(sql`
      insert into proceeding (workspace_id, matter_id, forum_id, case_type_code, sr_no, state, source_type)
      select ${workspaceId}::uuid, ${m.id}::uuid, ${graph.forumId}::uuid, 'WP', 'SR ' || g, 'defects', 'manual'
      from generate_series(1, ${PROCEEDINGS}) as g
      returning id`);
    return {
      workspaceId,
      ownerId,
      forumId: graph.forumId,
      matterId: m.id,
      proceedingIds,
      listingIds: listings.map((r) => r.id),
      defectIds: defects.map((r) => r.id),
    };
  });
}

/** A day `i` days after 2027-01-01, as `YYYY-MM-DD`. */
function futureDay(i: number): string {
  return new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10);
}

/** The `i`-th distinct ordered pair of proceedings (no self pairs). */
function pair(ids: string[], i: number): [string, string] {
  const from = i % ids.length;
  const to = (from + 1 + Math.floor(i / ids.length)) % ids.length;
  return [ids[from] ?? '', ids[to] ?? ''];
}

/** Each mutating service, as a call for sample `i` and as the write statement it issues. */
function services(deps: MatterGraphDeps, s: Transaction, d: Seeded) {
  const actor = { userId: d.ownerId, workspaceId: d.workspaceId };
  const created: string[] = [];
  const matterAt = (list: string[], i: number) => list[i % Math.max(list.length, 1)] ?? d.matterId;
  const doc = (i: number) => ({
    kind: 'pleading' as const,
    storageKey: `ws/${d.workspaceId}/document/${String(i)}-${randomUUID()}`,
    sha256: 'c'.repeat(64),
  });
  return {
    createMatter: {
      call: async (i: number) => {
        created.push((await createMatter(deps, actor, { title: `Perf ${String(i)}` })).id);
      },
      statement: (i: number): SQLWrapper =>
        s
          .insert(schema.matter)
          .values({ id: randomUUID(), workspaceId: d.workspaceId, title: `Stmt ${String(i)}` })
          .returning({ id: schema.matter.id }),
    },
    updateMatter: {
      call: (i: number) =>
        updateMatter(deps, actor, {
          matterId: matterAt(created, i),
          patch: { title: `Renamed ${String(i)}` },
        }),
      statement: (i: number): SQLWrapper =>
        s
          .update(schema.matter)
          .set({ title: `Stmt renamed ${String(i)}`, updatedAt: new Date() })
          .where(eq(schema.matter.id, d.matterId)),
    },
    archiveMatter: {
      call: (i: number) => archiveMatter(deps, actor, { matterId: matterAt(created, i) }),
      // The same status update, on the seeded matter (kept active so the calls are not no-ops).
      statement: (): SQLWrapper =>
        s
          .update(schema.matter)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(schema.matter.id, d.matterId)),
    },
    createProceeding: {
      call: (i: number) =>
        createProceeding(deps, actor, {
          matterId: d.matterId,
          forumId: d.forumId,
          caseType: 'W.M.P.',
          number: String(50000 + i),
          year: 2026,
          provenance: MANUAL,
        }),
      statement: (i: number): SQLWrapper =>
        s.insert(schema.proceeding).values({
          workspaceId: d.workspaceId,
          matterId: d.matterId,
          forumId: d.forumId,
          caseTypeCode: 'CMP',
          number: String(70000 + i),
          year: 2026,
          sourceType: 'manual',
        }),
    },
    updateIdentifiers: {
      call: (i: number) =>
        updateIdentifiers(deps, actor, {
          proceedingId: d.proceedingIds[i % PROCEEDINGS] ?? '',
          srNo: `SR ${String(i)}`,
        }),
      statement: (i: number): SQLWrapper =>
        s
          .update(schema.proceeding)
          .set({ frNo: `FR ${String(i)}`, updatedAt: new Date() })
          .where(eq(schema.proceeding.id, d.proceedingIds[i % PROCEEDINGS] ?? '')),
    },
    linkProceedings: {
      call: (i: number) => {
        const [from, to] = pair(d.proceedingIds, i);
        return linkProceedings(deps, actor, {
          fromProceedingId: from,
          toProceedingId: to,
          kind: 'connected',
          provenance: MANUAL,
        });
      },
      statement: (i: number): SQLWrapper => {
        const [from, to] = pair(d.proceedingIds, i);
        return s.insert(schema.proceedingLink).values({
          workspaceId: d.workspaceId,
          fromProceedingId: from,
          toProceedingId: to,
          kind: 'lower_court',
          sourceType: 'manual',
        });
      },
    },
    proposeNextDate: {
      call: (i: number) =>
        proposeNextDate(deps, actor, {
          proceedingId: d.proceedingIds[i % PROCEEDINGS] ?? '',
          date: futureDay(i),
          provenance: MANUAL,
        }),
      statement: (i: number): SQLWrapper =>
        s.insert(schema.listing).values({
          workspaceId: d.workspaceId,
          proceedingId: d.proceedingIds[i % PROCEEDINGS] ?? '',
          listDate: futureDay(1000 + i),
          listType: 'daily',
          stageRaw: '',
          sourceType: 'manual',
        }),
    },
    confirmNextDate: {
      call: (i: number) => confirmNextDate(deps, actor, { listingId: d.listingIds[i] ?? '' }),
      // The swap's two updates touch one row each by primary key; the target's is representative.
      statement: (i: number): SQLWrapper =>
        s
          .update(schema.listing)
          .set({ confirmationState: 'confirmed', updatedAt: new Date() })
          .where(eq(schema.listing.id, d.listingIds[i] ?? '')),
    },
    transitionProceeding: {
      // Sample i visits defect proceeding i % N for the floor(i / N)-th time: even visits move it to
      // re_presented, odd ones back to defects, so every call is a legal transition.
      call: (i: number) =>
        transitionProceeding(deps, actor, {
          proceedingId: d.defectIds[i % PROCEEDINGS] ?? '',
          to: Math.floor(i / PROCEEDINGS) % 2 === 0 ? 're_presented' : 'defects',
        }),
      statement: (i: number): SQLWrapper =>
        s.insert(schema.proceedingStateChange).values({
          workspaceId: d.workspaceId,
          proceedingId: d.defectIds[i % PROCEEDINGS] ?? '',
          fromState: 're_presented',
          toState: 'defects',
          cureDeadline: '2026-11-02',
          sourceType: 'manual',
          confirmationState: 'confirmed',
        }),
    },
    createDocument: {
      call: (i: number) => createDocument(deps, actor, { matterId: d.matterId, ...doc(i) }),
      statement: (i: number): SQLWrapper =>
        s
          .insert(schema.document)
          .values({ workspaceId: d.workspaceId, matterId: d.matterId, ...doc(i) }),
    },
  };
}

async function executionMs(s: Transaction, statement: SQLWrapper): Promise<number> {
  const [plan] = await s.execute<{ 'QUERY PLAN': [{ 'Execution Time': number }] }>(
    sql`explain (analyze, format json) ${statement.getSQL()}`,
  );
  return plan?.['QUERY PLAN'][0]['Execution Time'] ?? Number.POSITIVE_INFINITY;
}

describe(`matter-graph mutating services under ${String(BUDGET_MS)} ms p95`, () => {
  it('keeps each service write within budget on seeded data', { timeout: 300_000 }, async () => {
    await withTestDb(async (tx) => {
      const d = await seed(tx);
      expect(d.proceedingIds).toHaveLength(PROCEEDINGS);
      expect(d.defectIds).toHaveLength(PROCEEDINGS);
      await inWorkspace(tx, d.workspaceId, async (s) => {
        const deps: MatterGraphDeps = { db: s, events: { emit: () => undefined } };
        for (const [name, service] of Object.entries(services(deps, s, d))) {
          const wall: number[] = [];
          const execution: number[] = [];
          for (let i = 0; i < WARMUP + SAMPLES; i++) {
            const started = performance.now();
            await service.call(i);
            const elapsed = performance.now() - started;
            const ms = await executionMs(s, service.statement(i));
            if (i >= WARMUP) {
              wall.push(elapsed);
              execution.push(ms);
            }
          }
          const executionP95 = p95(execution);
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
