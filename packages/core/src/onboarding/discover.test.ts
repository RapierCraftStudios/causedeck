// Zero-entry onboarding discovery (#501): the advocate search runs per court through the fetcher
// port, only rows that carry the advocate are staged (as proposals on an import batch, never in the
// matter graph), a name alone prompts for disambiguation before anything is written, a same-name row
// with another enrolment number is left out, an uncleared court is skipped and counts only are logged.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../__tests__/fixtures.ts';
import { SourceNotCleared } from '../sources/index.ts';

import {
  DISCOVERY_SOURCES,
  discoverAdvocateCases,
  discoveryWindow,
  type DiscoverDeps,
  type DiscoveryFetcher,
} from './discover.ts';

const KHC = 'in.ka.karnataka-hc.bengaluru:advocate_search';
const MHC = 'in.tn.madras-hc.chennai:advocate_search';
const DAILY = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../adapters/fixtures/in.ka.karnataka-hc.bengaluru/list-01-daily-three-halls-two-lists.input.html',
  ),
  'utf8',
);
const SHA = 'a'.repeat(64);
const NOW = new Date('2026-10-21T04:00:00.000Z');

function fetcher(body = DAILY): DiscoveryFetcher & { urls: string[]; delegated: unknown[] } {
  const urls: string[] = [];
  const delegated: unknown[] = [];
  return {
    urls,
    delegated,
    fetchSource(_sourceId, url, options) {
      urls.push(url);
      delegated.push(options.delegatedFor);
      return Promise.resolve({
        body,
        provenance: { url, fetchedAt: NOW.toISOString(), sha256: SHA, tierUsed: 'http' },
      });
    },
  };
}

function deps(
  tx: Transaction,
  f: DiscoveryFetcher,
  extra: Partial<DiscoverDeps> = {},
): DiscoverDeps {
  return {
    db: tx,
    fetcher: f,
    clock: { now: () => NOW },
    policy: () => Promise.resolve({ baseUrl: 'https://khc.example.test/' }),
    ...extra,
  };
}

async function member(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  return { userId: ownerId, workspaceId };
}

const written = (tx: Transaction, workspaceId: string) =>
  inWorkspace(tx, workspaceId, async (s) => ({
    batches: await s.select().from(schema.importBatch),
    captures: await s.select().from(schema.capture),
    proposals: await s.select().from(schema.proposal),
    matters: await s.select().from(schema.matter),
  }));

describe('discoverAdvocateCases', () => {
  it('searches delegated, stages only matched rows as proposals with provenance, applies nothing', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      const f = fetcher();
      const logged: Array<[string, Record<string, number>]> = [];
      const outcome = await discoverAdvocateCases(
        deps(tx, f, { log: (event, counts) => logged.push([event, counts]) }),
        actor,
        { sourceIds: [KHC], enrolmentNumbers: ['KAR/1234/2001'] },
      );
      expect(outcome.status).toBe('staged');
      if (outcome.status !== 'staged') return;
      expect(outcome.counts.listings).toBeGreaterThan(0);
      expect(outcome.counts.unmatched).toBeGreaterThan(0);
      expect(outcome.courts).toEqual([
        expect.objectContaining({ sourceId: KHC, outcome: 'searched' }),
      ]);
      // Delegated for the member, enrolment and window in the query.
      expect(f.delegated[0]).toMatchObject({ advocateId: actor.userId });
      expect(f.urls[0]).toContain('enrolment=KAR%2F1234%2F2001');
      expect(f.urls[0]).toContain('from=2026-08-22');
      const rows = await written(tx, actor.workspaceId);
      expect(rows.proposals.length).toBe(outcome.counts.listings);
      for (const proposal of rows.proposals) {
        expect(proposal.status).toBe('proposed');
        expect(JSON.stringify(proposal.meta)).toContain('discovery:');
      }
      expect(JSON.stringify(rows.captures[0]?.sourceMeta)).toContain(SHA);
      expect(rows.matters).toEqual([]);
      // Counts only: no party name or case number in the log.
      expect(JSON.stringify(logged)).not.toMatch(/Kalpita|WP\//);
      expect(logged.some(([event]) => event === 'onboarding.discovery')).toBe(true);
    });
  });

  it('prompts for disambiguation on a name alone and writes nothing until samples are confirmed', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      const first = await discoverAdvocateCases(deps(tx, fetcher()), actor, {
        sourceIds: [KHC],
        names: ['A. Fictional'],
      });
      expect(first.status).toBe('needs_disambiguation');
      if (first.status !== 'needs_disambiguation') return;
      expect(first.samples.length).toBeGreaterThan(0);
      expect(first.candidateEnrolments).toContain('KAR/1234/2001');
      const empty = await written(tx, actor.workspaceId);
      expect(empty).toEqual({ batches: [], captures: [], proposals: [], matters: [] });

      const picked = first.samples.slice(0, 1).map((sample) => sample.matchKey);
      const second = await discoverAdvocateCases(deps(tx, fetcher()), actor, {
        sourceIds: [KHC],
        names: ['A. Fictional'],
        confirmedMatchKeys: picked,
      });
      expect(second.status).toBe('staged');
      const rows = await written(tx, actor.workspaceId);
      expect(rows.proposals).toHaveLength(1);
      expect(rows.matters).toEqual([]);
    });
  });

  it('leaves out a same-name advocate with another enrolment number, never merging', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      const outcome = await discoverAdvocateCases(deps(tx, fetcher()), actor, {
        sourceIds: [KHC],
        enrolmentNumbers: ['KAR/9999/2009'],
        names: ['A. Fictional'],
      });
      // The rows printing KAR/1234/2001 beside the same name are another advocate: reported, never staged.
      expect(outcome.counts.ambiguousExcluded).toBeGreaterThan(0);
      if (outcome.status === 'staged') {
        expect(outcome.ambiguous.length).toBeGreaterThan(0);
        const staged = new Set(
          (await written(tx, actor.workspaceId)).proposals.map((p) => JSON.stringify(p.payload)),
        );
        for (const sample of outcome.ambiguous) {
          expect([...staged].some((payload) => payload.includes(sample.matchKey))).toBe(false);
        }
      }
    });
  });

  it('skips an uncleared court and survives a failing one', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      const outcome = await discoverAdvocateCases(
        deps(tx, fetcher(), {
          policy: (id) =>
            id === MHC
              ? Promise.reject(new SourceNotCleared('uncleared', id))
              : Promise.resolve({ baseUrl: 'https://khc.example.test/' }),
          sources: {
            [KHC]: {
              ...(DISCOVERY_SOURCES[KHC] as NonNullable<(typeof DISCOVERY_SOURCES)[string]>),
              parse: () => Promise.reject(new Error('unreadable')),
            },
            [MHC]: DISCOVERY_SOURCES[MHC] as NonNullable<(typeof DISCOVERY_SOURCES)[string]>,
          },
        }),
        actor,
        { sourceIds: [MHC, KHC], enrolmentNumbers: ['KAR/1234/2001'] },
      );
      expect(outcome.status).toBe('nothing_found');
      expect(outcome.courts.map((c) => c.outcome)).toEqual(['not_cleared', 'failed']);
    });
  });

  it('rejects empty identifiers and an unknown court', async () => {
    await withTestDb(async (tx) => {
      const actor = await member(tx);
      await expect(
        discoverAdvocateCases(deps(tx, fetcher()), actor, { sourceIds: [KHC] }),
      ).rejects.toThrow();
      await expect(
        discoverAdvocateCases(deps(tx, fetcher()), actor, {
          sourceIds: ['nope'],
          names: ['A'],
        }),
      ).rejects.toThrow();
    });
  });
});

describe('discoveryWindow', () => {
  it('clamps the look-back to 30..90 days and adds the upcoming lists', () => {
    expect(discoveryWindow(NOW, 5).from).toBe('2026-09-21');
    expect(discoveryWindow(NOW, 500).from).toBe('2026-07-23');
    expect(discoveryWindow(NOW).to).toBe('2026-11-20');
  });
});
