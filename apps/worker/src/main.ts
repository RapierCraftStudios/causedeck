// Worker entry point (spike §1, §3.2): env, telemetry, logger, pg-boss, schedules, health server,
// and a graceful SIGTERM that gives in-flight jobs up to 30 s before pg-boss requeues them.
import { serverEnv } from '@causedeck/config/env';
import {
  registry,
  setCauseListFetcherFactory,
  setNoticeFetcherFactory,
  type NoticeFetcherFactory,
  setStatusFetcherFactory,
} from '@causedeck/core/jobs';
import { closeAppDb, db } from '@causedeck/core/runtime';
import { createFetchLogSink, policyFor } from '@causedeck/core/sources';
import { createFetcher, createProvider } from '@causedeck/fetch';
import { createLogger, initTelemetry } from '@causedeck/observability';

import { closeServer, startHealthServer, workerChecks } from './health.ts';
import { registerSchedules } from './schedules.ts';
import {
  createWorker,
  DB_CLOSE_TIMEOUT_SEC,
  handleShutdownSignals,
  SHUTDOWN_TIMEOUT_MS,
} from './worker.ts';

const env = serverEnv();
const telemetry = initTelemetry({ service: 'worker' });
const logger = createLogger({ service: 'worker' });

const ownerUrl = env.DATABASE_URL_OWNER;
if (ownerUrl === undefined) {
  logger.fatal('DATABASE_URL_OWNER is not set: the worker owns the pgboss schema');
  process.exit(1);
}

// The governed fetch layer (D-048) for `system.causelist.poll` (#482) and `system.notices.poll`
// (#586). Core sees only their structural fetcher shapes and never imports `@causedeck/fetch`
// (spike §2). Per-workspace usage stays with callers that know a workspace; these system jobs
// record none.
const governedFetcher = (jobDb: Parameters<NoticeFetcherFactory>[0]) =>
  createFetcher({
    registry: { policyFor: (id) => policyFor(id, { db: jobDb }) },
    alterlab: createProvider({ apiKey: env.ALTERLAB_API_KEY?.reveal() }),
    clock: { now: () => new Date() },
    usage: { record: () => Promise.resolve() },
    log: createFetchLogSink(jobDb),
  });
setCauseListFetcherFactory(governedFetcher);
setNoticeFetcherFactory(governedFetcher);

// The same governed fetcher for `system.status.poll` (#592): delegated case-status lookups only.
setStatusFetcherFactory((jobDb) =>
  createFetcher({
    registry: { policyFor: (id) => policyFor(id, { db: jobDb }) },
    alterlab: createProvider({ apiKey: env.ALTERLAB_API_KEY?.reveal() }),
    clock: { now: () => new Date() },
    usage: { record: () => Promise.resolve() },
    log: createFetchLogSink(jobDb),
  }),
);

const worker = createWorker({ connectionString: ownerUrl.reveal(), db, logger, registry });
const server = await startHealthServer({ port: env.WORKER_PORT, checks: workerChecks(worker) });

handleShutdownSignals(
  async () => {
    await worker.stop(SHUTDOWN_TIMEOUT_MS);
    await closeServer(server);
    // Bounded: a handler interrupted by the timeout may still hold a transaction open.
    await closeAppDb({ timeoutSec: DB_CLOSE_TIMEOUT_SEC });
    await telemetry.shutdown();
  },
  { logger },
);

await worker.start();
await registerSchedules(worker.boss, registry);
logger.info({ port: env.WORKER_PORT }, 'worker ready');
