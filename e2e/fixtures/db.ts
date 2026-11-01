// Per-worker database and web server (#16). Each Playwright worker clones the sealed template into
// its own database and starts its own server on it (support/server-pool.ts), so workers run fully
// in parallel. Before every test the worker database is dropped and cloned again, so each test
// starts from the same seeded rows.
import { test as base } from '@playwright/test';

import { resetWorkerDb, workerDbName } from '../support/db-reset.ts';
import { startServer, workerPort, type RunningServer } from '../support/server-pool.ts';
import { warmServer } from '../support/warm.ts';

export interface WorkerDb {
  /** Database name (`causedeck_e2e_w<N>`). */
  name: string;
  /** App-role URL of the worker database. */
  url: string;
  /** Drop and re-clone the worker database from the template; resolves to the time taken (ms). */
  reset: () => Promise<number>;
  /** Restore the seeded baseline (alias of `reset`: the template holds the `e2e` seed). */
  seed: () => Promise<void>;
}

export interface WorkerFixtures {
  workerDb: WorkerDb;
  workerServer: RunningServer;
}

export interface DbFixtures {
  /** The worker database, already reset for this test. */
  db: WorkerDb;
}

export const test = base.extend<DbFixtures, WorkerFixtures>({
  workerDb: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure.
    async ({}, use, workerInfo) => {
      const index = workerInfo.parallelIndex;
      const { url } = await resetWorkerDb(index);
      const db: WorkerDb = {
        name: workerDbName(index),
        url,
        reset: async () => (await resetWorkerDb(index)).ms,
        seed: async () => {
          await resetWorkerDb(index);
        },
      };
      await use(db);
    },
    { scope: 'worker' },
  ],
  workerServer: [
    async ({ workerDb }, use, workerInfo) => {
      const port = workerPort(workerInfo.parallelIndex);
      const server = await startServer(port, workerDb.url);
      try {
        // Pay the cold first request of every page here, not inside a timed test (#995).
        await warmServer(port);
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  db: [
    async ({ workerDb, workerServer }, use, testInfo) => {
      const ms = await workerDb.reset();
      testInfo.annotations.push({ type: 'db-reset-ms', description: String(ms) });
      const since = workerServer.logs().length;
      await use(workerDb);
      // A failing test gets the worker server's log for its duration.
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('server-log.txt', {
          body: workerServer.logs().slice(since),
          contentType: 'text/plain',
        });
      }
    },
    { auto: true },
  ],
  baseURL: async ({ workerServer }, use) => {
    await use(workerServer.url);
  },
});
