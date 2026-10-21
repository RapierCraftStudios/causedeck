// Matter-graph service budget (#362, AC of #33): p95 for each mutating service call stays under
// 100 ms on seeded data (a Chennai-solo graph plus a matter with 50 proceedings).
//
// As packages/db/src/__tests__/matter-graph-perf.test.ts does, the always-on gate measures Postgres
// execution time (`EXPLAIN (ANALYZE, FORMAT JSON)` runs the statement for real, triggers and FK
// checks included) of the write each service issues, after a warmup; wall-clock time on the shared,
// loaded build host measures the host as much as the code. The services themselves run for every
// sample too, and their wall-clock p95 is asserted with MATTER_GRAPH_PERF_GATE=1 on a quiet runner.
// Merges, splits and their undos (#365) consume what they act on, so each sample first builds its
// own small graph (`setup`, untimed); their statement is the widest re-point they issue, run on the
// seeded 50-proceeding matter.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildChennaiSoloGraph,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { eq, sql, type SQLWrapper } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  archiveMatter,
  createDocument,
  createMatter,
  createProceeding,
  linkProceedings,
  mergeMatters,
  mergeProceedings,
  splitMatter,
  undoMerge,
  undoMergeProceedings,
  undoSplit,
  updateIdentifiers,
  updateMatter,
  type MatterGraphDeps,
} from '../../index.ts';
import { newWorkspace } from '../../__tests__/fixtures.ts';

const PROCEEDINGS = 50;
const WARMUP = 20;
const SAMPLES = 100;
const BUDGET_MS = 100;
/** Proceedings per matter in a merge or split sample. */
const PER_SAMPLE = 5;
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
    return {
      workspaceId,
      ownerId,
      forumId: graph.forumId,
      matterId: m.id,
      proceedingIds: rows.map((r) => r.id),
    };
  });
}

/** The `i`-th distinct ordered pair of proceedings (no self pairs). */
function pair(ids: string[], i: number): [string, string] {
  const from = i % ids.length;
  const to = (from + 1 + Math.floor(i / ids.length)) % ids.length;
  return [ids[from] ?? '', ids[to] ?? ''];
}

interface Service {
  /** Untimed preparation for sample `i`; its result is handed to `call`. */
  setup?: (i: number) => Promise<unknown>;
  call: (i: number, prepared: never) => Promise<unknown>;
  statement: (i: number) => SQLWrapper;
}

/** Merges, splits and their undos, each on a small graph of its own. */
function mergeServices(deps: MatterGraphDeps, s: Transaction, d: Seeded) {
  const actor = { userId: d.ownerId, workspaceId: d.workspaceId };
  const ws = d.workspaceId;
  let serial = 0;
  // The sample's own rows the statement re-points: proceedings of matter `of` to matter `to`, or
  // listings of proceeding `of` to proceeding `to` (the widest write each service issues).
  let last = { to: '', of: '' };
  const matterWith = async (count: number) => {
    const m = await buildMatter(s, ws);
    const ids: string[] = [];
    for (let k = 0; k < count; k++) {
      serial += 1;
      const p = await buildProceeding(s, ws, {
        matterId: m.id,
        forumId: d.forumId,
        number: String(900000 + serial),
        year: 2026,
      });
      await buildListing(s, ws, { proceedingId: p.id, canonical: true });
      ids.push(p.id);
    }
    return { matterId: m.id, ids };
  };
  const mergePair = async () => {
    const into = await matterWith(PER_SAMPLE);
    const from = await matterWith(PER_SAMPLE);
    return { intoMatterId: into.matterId, fromMatterId: from.matterId };
  };
  const splitOne = async () => {
    const m = await matterWith(PER_SAMPLE + 1);
    return { matterId: m.matterId, proceedingIds: m.ids.slice(1), newTitle: 'Perf split' };
  };
  const duplicatePair = async () => {
    const m = await matterWith(1);
    const dup = await buildProceeding(s, ws, {
      matterId: m.matterId,
      forumId: d.forumId,
      // The same W.P. imported without normalisation: leading zero.
      number: `0${String(900000 + serial)}`,
      year: 2026,
    });
    await buildListing(s, ws, { proceedingId: dup.id, canonical: true });
    await buildListing(s, ws, { proceedingId: dup.id, listDate: '2026-10-01' });
    return { intoProceedingId: m.ids[0] ?? '', fromProceedingId: dup.id };
  };
  const proceedings = (): SQLWrapper =>
    s
      .update(schema.proceeding)
      .set({ matterId: last.to, updatedAt: new Date() })
      .where(eq(schema.proceeding.matterId, last.of));
  const listings = (): SQLWrapper =>
    s
      .update(schema.listing)
      .set({ proceedingId: last.to, updatedAt: new Date() })
      .where(eq(schema.listing.proceedingId, last.of));
  const services: Record<string, Service> = {
    mergeMatters: {
      setup: mergePair,
      call: async (_i, input: { intoMatterId: string; fromMatterId: string }) => {
        await mergeMatters(deps, actor, input);
        last = { to: input.fromMatterId, of: input.intoMatterId };
      },
      statement: proceedings,
    },
    undoMerge: {
      setup: async () => (await mergeMatters(deps, actor, await mergePair())).undo,
      call: async (_i, payload: Parameters<typeof undoMerge>[2]['payload']) => {
        await undoMerge(deps, actor, { payload });
        last = { to: payload.before.intoMatterId, of: payload.before.fromMatterId };
      },
      statement: proceedings,
    },
    splitMatter: {
      setup: splitOne,
      call: async (_i, input: Parameters<typeof splitMatter>[2]) => {
        const { matter } = await splitMatter(deps, actor, input);
        last = { to: input.matterId, of: matter.id };
      },
      statement: proceedings,
    },
    undoSplit: {
      setup: async () => (await splitMatter(deps, actor, await splitOne())).undo,
      call: async (_i, payload: Parameters<typeof undoSplit>[2]['payload']) => {
        await undoSplit(deps, actor, { payload });
        // The new matter is gone; re-point the restored proceedings in place.
        last = { to: payload.before.matterId, of: payload.before.matterId };
      },
      statement: proceedings,
    },
    mergeProceedings: {
      setup: duplicatePair,
      call: async (_i, input: { intoProceedingId: string; fromProceedingId: string }) => {
        await mergeProceedings(deps, actor, input);
        last = { to: input.intoProceedingId, of: input.intoProceedingId };
      },
      statement: listings,
    },
    undoMergeProceedings: {
      setup: async () => (await mergeProceedings(deps, actor, await duplicatePair())).undo,
      call: async (_i, payload: Parameters<typeof undoMergeProceedings>[2]['payload']) => {
        await undoMergeProceedings(deps, actor, { payload });
        last = { to: payload.before.fromProceedingId, of: payload.before.fromProceedingId };
      },
      statement: listings,
    },
  };
  return services;
}

/** Each mutating service, as a call for sample `i` and as the write statement it issues. */
function services(deps: MatterGraphDeps, s: Transaction, d: Seeded): Record<string, Service> {
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

type Pick = (deps: MatterGraphDeps, s: Transaction, d: Seeded) => Record<string, Service>;

/** Seeds a workspace in a fresh transaction and holds each picked service to the budget. */
async function measure(pick: Pick): Promise<void> {
  await withTestDb(async (tx) => {
    const d = await seed(tx);
    expect(d.proceedingIds).toHaveLength(PROCEEDINGS);
    await inWorkspace(tx, d.workspaceId, async (s) => {
      const deps: MatterGraphDeps = { db: s, events: { emit: () => undefined } };
      for (const [name, service] of Object.entries(pick(deps, s, d))) {
        const wall: number[] = [];
        const execution: number[] = [];
        for (let i = 0; i < WARMUP + SAMPLES; i++) {
          const prepared = (await service.setup?.(i)) as never;
          const started = performance.now();
          await service.call(i, prepared);
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
}

/** The named members of `mergeServices`. */
function only(...names: string[]): Pick {
  return (deps, s, d) => {
    const all = mergeServices(deps, s, d);
    return Object.fromEntries(names.map((name) => [name, all[name] as Service]));
  };
}

// Every service call opens a savepoint inside the one test transaction; past a few thousand,
// Postgres's visibility and foreign-key checks slow down for rows those savepoints touched, which
// a production call (its own transaction) never sees. Each merge or split service therefore gets
// its own transaction.
describe(`matter-graph mutating services under ${String(BUDGET_MS)} ms p95`, () => {
  it('keeps each service write within budget on seeded data', { timeout: 300_000 }, () =>
    measure(services),
  );

  // Each sample builds its own graph first, so these run longer than the budget they check.
  for (const name of [
    'mergeMatters',
    'undoMerge',
    'splitMatter',
    'undoSplit',
    'mergeProceedings',
    'undoMergeProceedings',
  ]) {
    it(`keeps ${name} within budget`, { timeout: 600_000 }, () => measure(only(name)));
  }
});
