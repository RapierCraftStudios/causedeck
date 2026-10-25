// The governed fetcher for the web server path of a case-status refresh (#593, D-048 tier 4): the
// same `createFetcher` wiring as the worker's `system.status.poll` (apps/worker/src/main.ts), so a
// refresh gets the source's tier cap, cost cap, kill switch and the per-advocate and per-source
// rate limits. Core sees only its structural `StatusFetcher`. The fetcher is one per process so its
// in-memory rate-limit windows hold across requests; the db of the call in flight reaches the
// registry and the fetch log through `AsyncLocalStorage`, never a shared variable.
import { AsyncLocalStorage } from 'node:async_hooks';

import type { StatusFetcher } from '@causedeck/core/case-watch';
import { createFetchLogSink, policyFor } from '@causedeck/core/sources';
import type { Queryable } from '@causedeck/db';
import { createFetcher, createProvider, type Fetcher } from '@causedeck/fetch';

import { serverEnv } from '../env.ts';

type Db = Queryable;

/** What the last lookup through a fetcher cost, for the refresh result (provenance of the fallback). */
export interface LookupProvenance {
  tierUsed: string;
  costDollars: number;
}

const scope = new AsyncLocalStorage<Db>();
let shared: Fetcher | undefined;

const currentDb = (): Db => {
  const db = scope.getStore();
  if (db === undefined) throw new Error('case-status fetcher used outside a refresh');
  return db;
};

function sharedFetcher(): Fetcher {
  shared ??= createFetcher({
    registry: { policyFor: (id) => policyFor(id, { db: currentDb() }) },
    alterlab: createProvider({ apiKey: serverEnv().ALTERLAB_API_KEY?.reveal() }),
    clock: { now: () => new Date() },
    usage: { record: () => Promise.resolve() },
    log: { record: (entry) => createFetchLogSink(currentDb()).record(entry) },
  });
  return shared;
}

/**
 * A `StatusFetcher` over the shared governed fetcher, bound to `db` for the lookup, plus a reader
 * of the provenance (tier used, cost) the last fetch through it reported.
 */
export function webStatusFetcher(db: Db): {
  fetcher: StatusFetcher;
  provenance: () => LookupProvenance | null;
} {
  let last: LookupProvenance | null = null;
  const fetcher: StatusFetcher = {
    async fetchSource(sourceId, url, opts) {
      const result = await scope.run(db, () => sharedFetcher().fetchSource(sourceId, url, opts));
      last = {
        tierUsed: result.provenance.tierUsed,
        costDollars: result.provenance.costDollars,
      };
      return result;
    },
  };
  return { fetcher, provenance: () => last };
}
