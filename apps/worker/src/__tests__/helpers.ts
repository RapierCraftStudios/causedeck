// Shared helpers for the worker integration tests: one Testcontainers Postgres per `vitest run`
// (globalSetup from @causedeck/db), a real pg-boss on the owner role, handlers on the app role.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import type { AnyJobDefinition } from '@causedeck/core/jobs';
import { testAppDb, testDatabaseUrls } from '@causedeck/db/testing';
import { createLogger, type Logger } from '@causedeck/observability';
import type { ConstructorOptions } from 'pg-boss';

import { createWorker, type Worker } from '../worker.ts';

export interface CapturedLogger {
  logger: Logger;
  raw: () => string;
  lines: () => Record<string, unknown>[];
}

/** A logger writing synchronously to memory. */
export function captureLogger(): CapturedLogger {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({
    service: 'worker-test',
    level: 'trace',
    runtime: { env: 'test', version: 'test', region: 'ap-south-1' },
    destination,
  });
  const raw = () => chunks.join('');
  return {
    logger,
    raw,
    lines: () =>
      raw()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/** A queue name unique to this test run, valid as `<domain>.<verb>`. */
export function uniqueName(verb: string): string {
  return `test.${verb}-${randomUUID().slice(0, 8)}`;
}

/** Fast pg-boss timings for tests. */
export const FAST_BOSS: Partial<ConstructorOptions> = {
  superviseIntervalSeconds: 1,
  maintenanceIntervalSeconds: 1,
  monitorIntervalSeconds: 1,
  queueCacheIntervalSeconds: 1,
};

const started: Worker[] = [];

export async function startTestWorker(
  definitions: readonly AnyJobDefinition[],
  options: { logger?: Logger; boss?: Partial<ConstructorOptions> } = {},
): Promise<Worker> {
  const worker = createWorker({
    connectionString: testDatabaseUrls().owner,
    db: testAppDb(),
    logger: options.logger ?? captureLogger().logger,
    registry: { definitions },
    pollingIntervalSeconds: 0.5,
    boss: { ...FAST_BOSS, ...options.boss },
  });
  started.push(worker);
  await worker.start();
  return worker;
}

/** Stop every worker started by `startTestWorker` (call from `afterEach`/`afterAll`). */
export async function stopTestWorkers(): Promise<void> {
  const workers = started.splice(0);
  await Promise.all(workers.map((w) => w.stop(1000)));
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined | false> | T | undefined | false,
  { timeoutMs = 30_000, intervalMs = 200 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
