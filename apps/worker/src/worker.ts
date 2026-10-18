// The pg-boss worker (spike §1, §3.2). It owns the `pgboss` schema: it connects as the schema owner,
// lets pg-boss migrate, creates one queue and one `<name>__dlq` per registered job, and runs every
// handler through `runJob`. Producers enqueue as the app role (`@causedeck/core/jobs`).
import {
  deadLetterQueue,
  PGBOSS_SCHEMA,
  runJob,
  type AnyJobDefinition,
  type JobOutcome,
} from '@causedeck/core/jobs';
import type { Database } from '@causedeck/db';
import type { Logger } from '@causedeck/observability';
import { PgBoss, type ConstructorOptions, type Job, type JobResult } from 'pg-boss';
import { GroupGate, fairnessGroupOf } from './fairness';

/** `boss.stop()` waits this long for in-flight jobs before failing them back to the queue. */
export const SHUTDOWN_TIMEOUT_MS = 30_000;
/** After the drain, open connections get this long (seconds) before the pool is closed hard. */
export const DB_CLOSE_TIMEOUT_SEC = 5;
/** Dead-lettered jobs are kept for 60 days so `jobs:dlq purge --older-than 30d` has work to do. */
export const DLQ_RETENTION_SECONDS = 60 * 24 * 60 * 60;

export interface JobRegistryLike {
  readonly definitions: readonly AnyJobDefinition[];
}

export interface CreateWorkerOptions {
  /** Owner-role connection string (`DATABASE_URL_OWNER`). */
  readonly connectionString: string;
  /** App-role client handlers run against (`DATABASE_URL`). */
  readonly db: Database;
  readonly logger: Logger;
  readonly registry: JobRegistryLike;
  /** Poll interval in seconds. pg-boss default 2; tests use 0.5. */
  readonly pollingIntervalSeconds?: number;
  /** Extra pg-boss constructor options (tests shorten intervals). */
  readonly boss?: Partial<ConstructorOptions>;
}

export interface Worker {
  readonly boss: PgBoss;
  start(): Promise<void>;
  /** Graceful stop: in-flight jobs get `timeoutMs` to finish, then are failed and retried later. */
  stop(timeoutMs?: number): Promise<void>;
  /** pg-boss is started and every registered handler is subscribed. */
  isReady(): boolean;
  /** Round trip to Postgres through pg-boss's pool. */
  ping(): Promise<void>;
}

function toResult(id: string, outcome: JobOutcome): JobResult {
  return outcome.status === 'completed'
    ? { id, status: 'completed' }
    : { id, status: outcome.status, output: { error: outcome.error } };
}

export async function ensureQueue(boss: PgBoss, def: AnyJobDefinition): Promise<void> {
  const dlq = deadLetterQueue(def.name);
  await boss.createQueue(dlq, { retentionSeconds: DLQ_RETENTION_SECONDS, retryLimit: 0 });
  const retry = {
    retryLimit: def.retry.limit,
    retryDelay: def.retry.delaySec,
    retryBackoff: def.retry.backoff,
    retryDelayMax: def.retry.delayMaxSec,
    expireInSeconds: def.timeoutSec,
  };
  await boss.createQueue(def.name, {
    ...retry,
    policy: def.singleton?.policy ?? 'standard',
    deadLetter: dlq,
  });
  // createQueue leaves an existing queue alone; keep its retry policy in step with the definition.
  await boss.updateQueue(def.name, {
    retryLimit: retry.retryLimit,
    retryDelay: retry.retryDelay,
    retryBackoff: retry.retryBackoff,
    expireInSeconds: retry.expireInSeconds,
  });
}

export function createWorker(options: CreateWorkerOptions): Worker {
  const { db, logger, registry } = options;
  const boss = new PgBoss({
    connectionString: options.connectionString,
    schema: PGBOSS_SCHEMA,
    application_name: 'causedeck-worker',
    ...options.boss,
  });
  boss.on('error', (err) => {
    logger.error({ err }, 'pg-boss error');
  });
  let ready = false;

  return {
    boss,
    async start() {
      await boss.start();
      for (const def of registry.definitions) {
        await ensureQueue(boss, def);
        // Exact per-process fairness cap; pg-boss groupConcurrency alone races across fetch loops.
        const gate = new GroupGate(def.fairnessConcurrency);
        await boss.work(
          def.name,
          {
            localConcurrency: def.concurrency,
            groupConcurrency: def.fairnessConcurrency,
            batchSize: 1,
            perJobResults: true,
            pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2,
          },
          async (jobs: Job<unknown>[]) => {
            const results: JobResult[] = [];
            for (const job of jobs) {
              const run = () => runJob(def, job, { db, logger });
              const outcome = await gate.run(fairnessGroupOf(job.data), run);
              results.push(toResult(job.id, outcome));
            }
            return results;
          },
        );
      }
      ready = true;
      logger.info({ queues: registry.definitions.map((d) => d.name) }, 'worker started');
    },
    async stop(timeoutMs = SHUTDOWN_TIMEOUT_MS) {
      ready = false;
      await boss.stop({ graceful: true, timeout: timeoutMs });
    },
    isReady: () => ready,
    async ping() {
      await boss.getDb().executeSql('select 1');
    },
  };
}

export interface ShutdownHooks {
  readonly logger: Logger;
  /** Defaults to `process.exit`. */
  readonly exit?: (code: number) => void;
  readonly signals?: readonly NodeJS.Signals[];
}

/**
 * On SIGTERM/SIGINT run `shutdown` once (e.g. `worker.stop()` then close pools) and exit 0, or 1 if
 * it throws. A second signal while stopping is ignored, so the 30 s drain is not cut short.
 */
export function handleShutdownSignals(shutdown: () => Promise<void>, hooks: ShutdownHooks): void {
  const exit = hooks.exit ?? ((code: number) => process.exit(code));
  let stopping = false;
  for (const signal of hooks.signals ?? (['SIGTERM', 'SIGINT'] as const)) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      hooks.logger.info({ signal }, 'worker stopping');
      shutdown().then(
        () => {
          hooks.logger.info('worker stopped');
          exit(0);
        },
        (err: unknown) => {
          hooks.logger.error({ err }, 'worker shutdown failed');
          exit(1);
        },
      );
    });
  }
}
