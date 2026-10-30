// Database pool health metrics (#805, monitoring #102): how long a connection takes to get, and
// whether transactions sit idle. The probe is a callback so this package never imports the database
// client: `@causedeck/core/runtime` wires `probeDbPool` for the runtime pool and the auth pool.
// Attributes are the pool name only, never SQL or tenant data.
import type { Meter } from '@opentelemetry/api';

import { meter } from './otel.ts';

export const DB_POOL_METRICS = {
  waitSeconds: 'causedeck_db_pool_wait_seconds',
  connections: 'causedeck_db_pool_connections',
  active: 'causedeck_db_pool_active',
  idleInTransaction: 'causedeck_db_idle_in_transaction',
  idleInTransactionMaxSeconds: 'causedeck_db_idle_in_transaction_max_seconds',
  probeErrors: 'causedeck_db_pool_probe_errors_total',
} as const;

/** One sample of a pool, as `probeDbPool` in `@causedeck/db` returns it. */
export interface DbPoolSample {
  /** Seconds to get a connection and answer a trivial query: the queue wait plus a round trip. */
  readonly waitSeconds: number;
  readonly connections: number;
  readonly active: number;
  readonly idleInTransaction: number;
  readonly idleInTransactionMaxSeconds: number;
}

export type DbPoolProbes = Readonly<Record<string, () => Promise<DbPoolSample>>>;

let registered: Meter | undefined;

/**
 * Report every probed pool on each metrics export. A probe that throws (connect timeout, database
 * down) increments `causedeck_db_pool_probe_errors_total` and reports no gauges for that pool.
 * Idempotent per meter provider.
 */
export function registerDbPoolMetrics(probes: DbPoolProbes): void {
  const current = meter();
  if (registered === current) return;
  registered = current;

  const errors = current.createCounter(DB_POOL_METRICS.probeErrors, {
    description: 'Pool probes that failed (connect timeout, database unreachable)',
  });
  const gauge = (name: string, description: string) =>
    current.createObservableGauge(name, { description });
  const wait = gauge(
    DB_POOL_METRICS.waitSeconds,
    'Seconds to get a connection and run a probe query',
  );
  const connections = gauge(DB_POOL_METRICS.connections, 'Open app-role connections');
  const active = gauge(DB_POOL_METRICS.active, 'App-role connections running a query');
  const idle = gauge(DB_POOL_METRICS.idleInTransaction, 'Connections idle in a transaction');
  const idleMax = gauge(
    DB_POOL_METRICS.idleInTransactionMaxSeconds,
    'Age in seconds of the longest idle-in-transaction connection',
  );

  current.addBatchObservableCallback(
    async (result) => {
      for (const [pool, probe] of Object.entries(probes)) {
        try {
          const sample = await probe();
          const attributes = { pool };
          result.observe(wait, sample.waitSeconds, attributes);
          result.observe(connections, sample.connections, attributes);
          result.observe(active, sample.active, attributes);
          result.observe(idle, sample.idleInTransaction, attributes);
          result.observe(idleMax, sample.idleInTransactionMaxSeconds, attributes);
        } catch {
          errors.add(1, { pool });
        }
      }
    },
    [wait, connections, active, idle, idleMax],
  );
}

/** Test hook. */
export function resetDbPoolMetrics(): void {
  registered = undefined;
}
