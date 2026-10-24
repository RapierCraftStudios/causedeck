// The orders poll (#494): a new order on a watched matter becomes a capture for the advocate within
// one poll (queued for extraction), fetched delegated for their own matter; a second poll captures
// nothing twice; a sensitive matter is never auto-captured.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { buildForum } from '@causedeck/db/testing/matter-graph-fixtures';
import { createMemoryObjectStore } from '@causedeck/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';
import { captureConfigFromProcess } from '../capture/index.ts';
import { createMatter, createProceeding } from '../matter-graph/index.ts';

import { runCaseStatusLookup, type StatusFetcher } from './lookup.ts';
import { pollOrders } from './orders.ts';
import { addCaseWatch } from './watch.ts';

const SOURCE_ID = 'xt.case-status';
const BASE = 'https://status.example.test/';
const NOW = new Date('2026-10-21T06:00:00Z');
const PAGE = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../adapters/fixtures/status/karnataka-hc/status-01-preliminary.input.html',
  ),
  'utf8',
);

type Call = { url: string; delegatedFor: { advocateId: string; matterId: string } };

function fetcherFor(page: string): StatusFetcher & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetchSource(_id, url, opts) {
      calls.push({ url, delegatedFor: opts.delegatedFor });
      return Promise.resolve({
        // The status page first, then one distinct body per order link.
        body: url.includes('case-status') ? page : `order ${url}`,
        provenance: {
          url,
          fetchedAt: NOW.toISOString(),
          sha256: 'x'.repeat(64),
          tierUsed: 'captcha',
          costDollars: 0,
        },
      });
    },
  };
}

async function watched(tx: Transaction, sensitive = false) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const forum = await inWorkspace(tx, workspaceId, (s) => buildForum(s, workspaceId));
  const deps = { db: tx, events: { emit() {} }, now: () => NOW };
  const owner = { userId: ownerId, workspaceId };
  const matter = await createMatter(deps, owner, { title: 'Ilango v. State (fictional)' });
  if (sensitive) {
    await inWorkspace(tx, workspaceId, (s) =>
      s.update(schema.matter).set({ sensitive: true }).where(eq(schema.matter.id, matter.id)),
    );
  }
  const proceeding = await createProceeding(deps, owner, {
    matterId: matter.id,
    forumId: forum.id,
    caseType: 'W.P.',
    number: '101',
    year: 2026,
    provenance: { sourceType: 'manual' },
  });
  await tx
    .insert(schema.source)
    .values({ id: SOURCE_ID, kind: 'court', baseUrl: 'https://status.example.test', owner: 'xt' })
    .onConflictDoNothing();
  const watch = await addCaseWatch({ db: tx }, owner, {
    proceedingId: proceeding.id,
    sourceId: SOURCE_ID,
    cnr: 'KAHC010056782026',
  });
  const fetcher = fetcherFor(PAGE);
  await runCaseStatusLookup(
    {
      db: tx,
      fetcher,
      events: deps.events,
      now: () => NOW,
      policy: () => Promise.resolve({ baseUrl: BASE }),
      sources: { [SOURCE_ID]: { template: 'karnataka-hc', path: 'case-status' } },
    },
    owner,
    { watchId: watch.id },
  );
  fetcher.calls.length = 0;
  const due = [{ watchId: watch.id, workspaceId, advocateUserId: ownerId, sourceId: SOURCE_ID }];
  const jobs = { scan: vi.fn(), process: vi.fn() };
  const poll = () =>
    pollOrders({
      db: tx,
      fetcher,
      store: createMemoryObjectStore(),
      config: { ...captureConfigFromProcess(), scan: { required: false, clamav: null } },
      jobs,
      now: () => NOW,
      policy: () => Promise.resolve({ baseUrl: BASE }),
      listDue: () => Promise.resolve(due),
    });
  return { tx, workspaceId, ownerId, matterId: matter.id, fetcher, jobs, poll };
}

const captures = (w: { tx: Transaction; workspaceId: string }) =>
  inWorkspace(w.tx, w.workspaceId, (s) => s.select().from(schema.capture));

describe('pollOrders', () => {
  it('captures each new order delegated for the advocate’s matter, once', async () => {
    await withTestDb(async (tx) => {
      const w = await watched(tx);
      const report = await w.poll();
      expect(report).toMatchObject({ captured: 2, duplicates: 0, failed: 0 });
      expect(w.fetcher.calls).toHaveLength(2);
      for (const c of w.fetcher.calls) {
        expect(c.delegatedFor).toEqual({ advocateId: w.ownerId, matterId: w.matterId });
      }
      const rows = await captures(w);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ matterHintId: w.matterId, createdBy: w.ownerId });
      expect(w.jobs.process).toHaveBeenCalledTimes(2);

      const again = await w.poll();
      expect(again).toMatchObject({ captured: 0, failed: 0 });
      expect(await captures(w)).toHaveLength(2);
    });
  });

  it('never auto-captures an order of a sensitive matter', async () => {
    await withTestDb(async (tx) => {
      const w = await watched(tx, true);
      const report = await w.poll();
      expect(report.captured).toBe(0);
      expect(w.fetcher.calls).toHaveLength(0);
      expect(await captures(w)).toEqual([]);
    });
  });
});
