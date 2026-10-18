// Retry policy, exponential backoff and dead-letter queues (#15).
import { randomUUID } from 'node:crypto';

import {
  deadLetterQueue,
  defineJob,
  PermanentError,
  RetryableError,
  systemPing,
} from '@causedeck/core/jobs';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ensureQueue } from '../worker.ts';

import { startTestWorker, stopTestWorkers, uniqueName, waitFor } from './helpers.ts';

afterEach(async () => {
  await stopTestWorkers();
});

function failingJob(error: () => Error, retry = { limit: 2, delaySec: 1 }) {
  const attempts: { at: number; attempt: number }[] = [];
  const def = defineJob({
    name: uniqueName('fail'),
    schema: z.object({ workspaceId: z.uuid() }),
    retry,
    handler: (ctx) => {
      attempts.push({ at: Date.now(), attempt: ctx.attempt });
      return Promise.reject(error());
    },
  });
  return { def, attempts };
}

describe('retry policy', () => {
  it('defaults to 5 attempts with exponential backoff and a <name>__dlq dead-letter queue', async () => {
    const worker = await startTestWorker([]);
    await ensureQueue(worker.boss, systemPing);

    const queue = await worker.boss.getQueue('system.ping');
    expect(queue).toMatchObject({
      retryLimit: 4,
      retryDelay: 5,
      retryBackoff: true,
      deadLetter: 'system.ping__dlq',
    });
    expect(await worker.boss.getQueue('system.ping__dlq')).not.toBeNull();
  });

  it('retries retryable failures with growing delays, then dead-letters the job', async () => {
    const { def, attempts } = failingJob(() => new RetryableError('UPSTREAM_DOWN'));
    const worker = await startTestWorker([def]);
    const workspaceId = randomUUID();
    const id = await worker.boss.send(def.name, { workspaceId });

    const [dead] = await waitFor(async () => {
      const found = await worker.boss.findJobs(deadLetterQueue(def.name));
      return found.length > 0 && found;
    });
    expect(attempts.map((a) => a.attempt)).toEqual([1, 2, 3]);
    expect(dead).toMatchObject({ data: { workspaceId }, sourceName: def.name, sourceId: id });
    const [original] = await worker.boss.findJobs(def.name, { id: id ?? '' });
    expect(original?.state).toBe('failed');
    // Backoff: the delay before attempt 3 is at least 2 × retryDelay (minus polling slack).
    const [a1, a2, a3] = attempts.map((a) => a.at);
    expect((a2 ?? 0) - (a1 ?? 0)).toBeGreaterThanOrEqual(900);
    expect((a3 ?? 0) - (a2 ?? 0)).toBeGreaterThanOrEqual(1900);
  });

  it('skips retries for PermanentError and dead-letters on the first failure', async () => {
    const { def, attempts } = failingJob(() => new PermanentError('NOT_FOUND'), {
      limit: 4,
      delaySec: 1,
    });
    const worker = await startTestWorker([def]);
    const id = await worker.boss.send(def.name, { workspaceId: randomUUID() });

    const [dead] = await waitFor(async () => {
      const found = await worker.boss.findJobs(deadLetterQueue(def.name));
      return found.length > 0 && found;
    });
    expect(attempts).toHaveLength(1);
    expect(dead?.sourceId).toBe(id);
    expect(dead?.sourceOutput).toEqual({ error: { name: 'PermanentError', code: 'NOT_FOUND' } });
  });
});
