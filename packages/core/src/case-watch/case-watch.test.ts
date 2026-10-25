// Case-status watches (#591): own watches only; a lookup is always delegated for the advocate and
// their own matter, and another advocate's watch, an unscoped call or an uncleared source never
// fetches; snapshots carry the tier, cost and via; an unchanged page writes no second row; a new
// next date stages one L2 `case_status_change` proposal that accepting confirms via matter-graph.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { schema, type Transaction } from '@causedeck/db';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { acceptProposal } from '../automation/index.ts';
import { newWorkspace } from '../__tests__/fixtures.ts';
import {
  createMatter,
  createProceeding,
  getCanonicalNextDate,
  type MatterGraphDeps,
} from '../matter-graph/index.ts';
import { SourceNotCleared } from '../sources/index.ts';

import { addCaseWatch, listCaseWatches, removeCaseWatch } from './watch.ts';
import {
  hashStatusFields,
  recordDeviceSnapshot,
  runCaseStatusLookup,
  STATUS_SOURCES,
  type CaseStatusLookupDeps,
  type StatusFetcher,
} from './lookup.ts';
import { parseCaseStatus } from '@causedeck/adapters';

interface World {
  tx: Transaction;
  workspaceId: string;
  ownerId: string;
  owner: { userId: string; workspaceId: string };
  deps: MatterGraphDeps;
  matterId: string;
  proceedingId: string;
}

/** A workspace with a matter and a proceeding. */
async function world(tx: Transaction): Promise<World> {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const deps: MatterGraphDeps = { db: tx, events: { emit() {} }, now: () => NOW };
  const owner = { userId: ownerId, workspaceId };
  const matter = await createMatter(deps, owner, { title: 'Ilango v. State (fictional)' });
  const proceeding = await createProceeding(deps, owner, {
    matterId: matter.id,
    forumId: forum.id,
    caseType: 'W.P.',
    number: '101',
    year: 2026,
    provenance: { sourceType: 'manual' },
  });
  return {
    tx,
    workspaceId,
    ownerId,
    owner,
    deps,
    matterId: matter.id,
    proceedingId: proceeding.id,
  };
}

const SOURCE_ID = 'xt.case-status';
const CNR = 'KAHC010056782026';
const FIXTURE = path.resolve(
  import.meta.dirname,
  '../../../adapters/fixtures/status/karnataka-hc/status-01-preliminary.input.html',
);
const PAGE = readFileSync(FIXTURE, 'utf8');
const MOVED = PAGE.replace('17-12-2026', '21-01-2027');
const NOW = new Date('2026-10-21T06:00:00Z');

type Call = { url: string; delegatedFor: { advocateId: string; matterId: string } };

function fakeFetcher(page: () => string): StatusFetcher & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetchSource(_id, url, opts) {
      calls.push({ url, delegatedFor: opts.delegatedFor });
      return Promise.resolve({
        body: page(),
        provenance: {
          url,
          fetchedAt: NOW.toISOString(),
          sha256: 'x'.repeat(64),
          tierUsed: 'captcha',
          costDollars: 0.002,
        },
      });
    },
  };
}

function deps(w: World, fetcher: StatusFetcher, extra: Partial<CaseStatusLookupDeps> = {}) {
  return {
    db: w.tx,
    fetcher,
    events: w.deps.events,
    now: () => NOW,
    policy: () => Promise.resolve({ baseUrl: 'https://status.example.test/' }),
    sources: { [SOURCE_ID]: { template: 'karnataka-hc' as const, path: 'case-status' } },
    ...extra,
  };
}

async function watched(tx: Transaction) {
  const w = await world(tx);
  await tx
    .insert(schema.source)
    .values({ id: SOURCE_ID, kind: 'court', baseUrl: 'https://status.example.test', owner: 'xt' })
    .onConflictDoNothing();
  const watch = await addCaseWatch({ db: tx }, w.owner, {
    proceedingId: w.proceedingId,
    sourceId: SOURCE_ID,
    cnr: CNR,
  });
  return { w, watch };
}

const snapshots = (w: World) =>
  inWorkspace(w.tx, w.workspaceId, (s) => s.select().from(schema.caseStatusSnapshot));
const proposals = (w: World) =>
  inWorkspace(w.tx, w.workspaceId, (s) => s.select().from(schema.proposal));

describe('watch services', () => {
  it('creates idempotently, lists and removes only the advocate’s own watch', async () => {
    await withTestDb(async (tx) => {
      const { w, watch } = await watched(tx);
      const again = await addCaseWatch({ db: tx }, w.owner, {
        proceedingId: w.proceedingId,
        sourceId: SOURCE_ID,
        cnr: CNR.toLowerCase(),
      });
      expect(again.id).toBe(watch.id);
      expect(await listCaseWatches({ db: tx }, w.owner)).toHaveLength(1);
      await expect(
        addCaseWatch({ db: tx }, w.owner, {
          proceedingId: w.proceedingId,
          sourceId: SOURCE_ID,
          cnr: 'nope',
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await removeCaseWatch({ db: tx }, w.owner, watch.id);
      expect(await listCaseWatches({ db: tx }, w.owner)).toEqual([]);
    });
  });
});

describe('runCaseStatusLookup', () => {
  it('fetches delegated for the advocate and the proceeding’s matter, and stores provenance', async () => {
    await withTestDb(async (tx) => {
      const { w, watch } = await watched(tx);
      const fetcher = fakeFetcher(() => PAGE);
      const report = await runCaseStatusLookup(deps(w, fetcher), w.owner, { watchId: watch.id });
      expect(report.outcome).toBe('changed');
      expect(fetcher.calls).toHaveLength(1);
      expect(fetcher.calls[0]?.delegatedFor).toEqual({
        advocateId: w.ownerId,
        matterId: w.matterId,
      });
      expect(fetcher.calls[0]?.url).toContain(`cnr=${CNR}`);
      const [row] = await snapshots(w);
      expect(row).toMatchObject({ via: 'server', tierUsed: 'captcha', watchId: watch.id });
      expect(Number(row?.costDollars)).toBeCloseTo(0.002);
      expect(row?.contentHash).toBe(hashStatusFields(parseCaseStatus('karnataka-hc', PAGE)));
    });
  });

  it('refuses another advocate’s watch, an unknown source and an uncleared source without fetching', async () => {
    await withTestDb(async (tx) => {
      const { w, watch } = await watched(tx);
      const fetcher = fakeFetcher(() => PAGE);
      const other = await world(tx);
      await expect(
        runCaseStatusLookup(deps(w, fetcher), other.owner, { watchId: watch.id }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        runCaseStatusLookup(deps(w, fetcher), w.owner, {
          watchId: '00000000-0000-4000-8000-000000000999',
        }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        runCaseStatusLookup(deps(w, fetcher, { sources: {} }), w.owner, { watchId: watch.id }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
      await expect(
        runCaseStatusLookup(
          deps(w, fetcher, {
            policy: () => Promise.reject(new SourceNotCleared('uncleared', SOURCE_ID)),
          }),
          w.owner,
          { watchId: watch.id },
        ),
      ).rejects.toBeInstanceOf(SourceNotCleared);
      expect(fetcher.calls).toEqual([]);
      expect(await snapshots(w)).toEqual([]);
    });
  });

  it('writes no second snapshot for an unchanged page', async () => {
    await withTestDb(async (tx) => {
      const { w, watch } = await watched(tx);
      const fetcher = fakeFetcher(() => PAGE);
      await runCaseStatusLookup(deps(w, fetcher), w.owner, { watchId: watch.id });
      const again = await runCaseStatusLookup(deps(w, fetcher), w.owner, { watchId: watch.id });
      expect(again.outcome).toBe('unchanged');
      expect(await snapshots(w)).toHaveLength(1);
      expect(await proposals(w)).toHaveLength(1);
    });
  });

  it('stages one case_status_change proposal that accepting confirms as the next date', async () => {
    await withTestDb(async (tx) => {
      const { w, watch } = await watched(tx);
      let page = PAGE;
      const fetcher = fakeFetcher(() => page);
      await runCaseStatusLookup(deps(w, fetcher), w.owner, { watchId: watch.id });
      page = MOVED;
      const report = await runCaseStatusLookup(deps(w, fetcher), w.owner, { watchId: watch.id });
      expect(report.changes?.nextHearingDate).toEqual({ from: '2026-12-17', to: '2027-01-21' });
      const staged = (await proposals(w)).filter((p) => p.kind === 'case_status_change');
      expect(staged.map((p) => p.level)).toEqual(['L2', 'L2']);
      const latest = staged.find((p) => JSON.stringify(p.payload).includes('2027-01-21'));
      expect(latest).toBeDefined();
      expect(await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId })).toBe(
        null,
      );
      await acceptProposal(w.deps, w.owner, { proposalId: latest?.id ?? '' });
      const next = await getCanonicalNextDate(w.deps, w.owner, { proceedingId: w.proceedingId });
      expect(String(next?.listDate)).toContain('2027-01-21');
    });
  });
});

describe('district sources (#636)', () => {
  const DISTRICT_PAGE = readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../adapters/fixtures/status/ecourts-district/status-01-evidence.input.html',
    ),
    'utf8',
  );

  it('registers a status source for each district state', () => {
    for (const st of ['tn', 'ka', 'mh', 'dl', 'up'])
      expect(STATUS_SOURCES[`in.${st}.district:case_status`]).toEqual({
        template: 'ecourts-district',
        path: 'case-status',
      });
  });

  it('refreshes a watched district matter through a delegated lookup, with provenance', async () => {
    await withTestDb(async (tx) => {
      const w = await world(tx);
      const sourceId = 'in.ka.district:case_status';
      const watch = await addCaseWatch({ db: tx }, w.owner, {
        proceedingId: w.proceedingId,
        sourceId,
        cnr: CNR,
      });
      const fetcher = fakeFetcher(() => DISTRICT_PAGE);
      const report = await runCaseStatusLookup(
        {
          db: tx,
          fetcher,
          events: w.deps.events,
          now: () => NOW,
          policy: () => Promise.resolve({ baseUrl: 'https://services.ecourts.gov.in/' }),
        },
        w.owner,
        { watchId: watch.id },
      );
      expect(report.outcome).toBe('changed');
      expect(fetcher.calls[0]?.delegatedFor).toEqual({
        advocateId: w.ownerId,
        matterId: w.matterId,
      });
      expect(fetcher.calls[0]?.url).toContain('https://services.ecourts.gov.in/case-status');
      const [row] = await snapshots(w);
      expect(row).toMatchObject({ via: 'server', tierUsed: 'captcha', watchId: watch.id });
      expect(row?.sourceRef).toContain('services.ecourts.gov.in');
    });
  });
});

describe('recordDeviceSnapshot', () => {
  it('stores a device-read status with no tier or cost, only on the advocate’s own watch', async () => {
    await withTestDb(async (tx) => {
      const { w, watch } = await watched(tx);
      const status = parseCaseStatus('karnataka-hc', PAGE);
      const report = await recordDeviceSnapshot(
        { db: tx, events: w.deps.events, now: () => NOW },
        w.owner,
        {
          watchId: watch.id,
          status,
        },
      );
      expect(report.outcome).toBe('changed');
      const [row] = await snapshots(w);
      expect(row).toMatchObject({ via: 'device', tierUsed: null });
      expect(Number(row?.costDollars)).toBe(0);
      const other = await world(tx);
      await expect(
        recordDeviceSnapshot({ db: tx }, other.owner, { watchId: watch.id, status }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});
