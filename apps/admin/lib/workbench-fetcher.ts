// The fixture workbench's governed one-off fetch (#598 R8, D-048). The same `createFetcher` wiring
// as apps/web/lib/case-watch/fetcher.ts, so a workbench fetch gets the source's clearance, tier cap,
// cost cap, kill switch and rate limits. `fetch_log` stays body-free: the body goes straight to the
// caller and is never stored here.
//
// Dark by default: the input is offered only while the flag `adapters.workbench-fetch` is on (and
// `KILL_ADAPTERS_WORKBENCH_FETCH` is unset). With no `ALTERLAB_API_KEY` the provider is the mock
// (deterministic placeholder pages, zero cost), so the whole flow works offline; the live switch is
// the AlterLab key plus the flag row, nothing else.
import { AsyncLocalStorage } from 'node:async_hooks';

import { killSwitch } from '@causedeck/config/env';
import { createFetchLogSink, policyFor } from '@causedeck/core/sources';
import type { Queryable } from '@causedeck/db';
import { asStaff, FLAGS, listGlobalFlagRows, resolveFlag } from '@causedeck/flags';
import { createFetcher, createProvider, type Fetcher, type FetchProvider } from '@causedeck/fetch';

import { serverEnv } from './env.ts';

export const WORKBENCH_FETCH_FLAG = 'adapters.workbench-fetch' as const;

/** Whether the workbench may offer a fetch: the global flag row on and no kill switch. */
export async function workbenchFetchEnabled(db: Queryable, staffUserId: string): Promise<boolean> {
  const def = FLAGS[WORKBENCH_FETCH_FLAG];
  const killed = killSwitch(def.killSwitchEnv, serverEnv());
  if (killed) return false;
  const rows = await listGlobalFlagRows(db, asStaff(staffUserId));
  const row = rows.find((r) => r.key === WORKBENCH_FETCH_FLAG);
  return resolveFlag(def, {
    killed,
    global: row === undefined ? undefined : { enabled: row.enabled, legalAckBy: row.legalAckBy },
  });
}

/** The live provider needs `ALTERLAB_API_KEY`; without it the mock answers. */
export function workbenchProvider(): FetchProvider {
  return createProvider({ apiKey: serverEnv().ALTERLAB_API_KEY?.reveal() });
}

const scope = new AsyncLocalStorage<Queryable>();
let shared: Fetcher | undefined;

const currentDb = (): Queryable => {
  const db = scope.getStore();
  if (db === undefined) throw new Error('workbench fetcher used outside a fetch');
  return db;
};

/** One fetcher per process so its rate-limit windows hold across requests. */
function sharedFetcher(): Fetcher {
  shared ??= createFetcher({
    registry: { policyFor: (id) => policyFor(id, { db: currentDb() }) },
    alterlab: workbenchProvider(),
    clock: { now: () => new Date() },
    usage: { record: () => Promise.resolve() },
    log: { record: (entry) => createFetchLogSink(currentDb()).record(entry) },
  });
  return shared;
}

/** The shared governed fetcher, bound to `db` for the call in flight. */
export function workbenchFetcher(db: Queryable): Fetcher {
  return {
    fetchSource: (sourceId, url, opts) =>
      scope.run(db, () => sharedFetcher().fetchSource(sourceId, url, opts)),
  };
}
