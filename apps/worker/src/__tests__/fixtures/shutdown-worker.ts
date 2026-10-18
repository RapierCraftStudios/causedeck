// Child process for shutdown.test.ts: a real worker with one slow job and the production signal
// handling (`handleShutdownSignals`). Prints `ready`, `started` and `finished` lines on stdout.
import { Secret } from '@causedeck/config/env';
import { defineJob } from '@causedeck/core/jobs';
import { createDb } from '@causedeck/db';
import { createLogger } from '@causedeck/observability';
import { z } from 'zod';

import { createWorker, DB_CLOSE_TIMEOUT_SEC, handleShutdownSignals } from '../../worker.ts';

// eslint-disable-next-line no-process-env -- test child process configured by its parent test.
const { OWNER_URL, APP_URL, QUEUE, JOB_MS, STOP_TIMEOUT_MS } = process.env;
if (OWNER_URL === undefined || APP_URL === undefined || QUEUE === undefined) {
  throw new Error('OWNER_URL, APP_URL and QUEUE are required');
}

const say = (line: string) => process.stdout.write(`${line}\n`);
const db = createDb({ url: new Secret(APP_URL), role: 'app', max: 2 });
const logger = createLogger({ service: 'shutdown-fixture', level: 'silent' });
const slow = defineJob({
  name: QUEUE,
  schema: z.object({ workspaceId: z.uuid() }),
  retry: { limit: 3, delaySec: 1 },
  handler: async (ctx) => {
    say(`started ${ctx.jobId} attempt ${String(ctx.attempt)}`);
    await new Promise((resolve) => setTimeout(resolve, Number(JOB_MS ?? '2000')));
    say(`finished ${ctx.jobId}`);
  },
});
const worker = createWorker({
  connectionString: OWNER_URL,
  db,
  logger,
  registry: { definitions: [slow] },
  pollingIntervalSeconds: 0.5,
});

handleShutdownSignals(
  async () => {
    await worker.stop(Number(STOP_TIMEOUT_MS ?? '30000'));
    await db.$client.end({ timeout: DB_CLOSE_TIMEOUT_SEC });
    say('stopped');
  },
  { logger },
);

await worker.start();
say('ready');
