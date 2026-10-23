// Registry, producer, per-queue concurrency, singletonKey and fairness (#15).
import { randomUUID } from 'node:crypto';

import {
  contentFieldViolations,
  createProducer,
  createRegistry,
  defineJob,
  enqueue,
  registry,
  type JobSender,
} from '@causedeck/core/jobs';
import { testDatabaseUrls } from '@causedeck/db/testing';
import type { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ensureQueue } from '../worker.ts';

import { sleep, startTestWorker, stopTestWorkers, uniqueName, waitFor } from './helpers.ts';

let producer: PgBoss;

beforeAll(async () => {
  // Producers connect as the app role: this also proves the pgboss grants from the migration.
  const owner = await startTestWorker([]);
  for (const def of registry.definitions) await ensureQueue(owner.boss, def);
  await owner.stop(1000);
  producer = createProducer(testDatabaseUrls().app);
  await producer.start();
});

afterEach(async () => {
  await stopTestWorkers();
});

afterAll(async () => {
  await producer.stop({ graceful: false });
});

/** A job that records how many of its runs overlap. */
function trackingJob(options: {
  concurrency: number;
  fairnessConcurrency?: number;
  singleton?: boolean;
  ms?: number;
}) {
  const state = { active: 0, max: 0, done: 0 };
  const def = defineJob({
    name: uniqueName('track'),
    schema: z.object({
      workspaceId: z.uuid(),
      fairnessKey: z.string().optional(),
      key: z.string(),
    }),
    concurrency: options.concurrency,
    ...(options.fairnessConcurrency !== undefined && {
      fairnessConcurrency: options.fairnessConcurrency,
    }),
    ...(options.singleton === true && { singleton: { key: (p: { key: string }) => p.key } }),
    handler: async () => {
      state.active += 1;
      state.max = Math.max(state.max, state.active);
      await sleep(options.ms ?? 300);
      state.active -= 1;
      state.done += 1;
    },
  });
  return { def, state, jobs: createRegistry([def] as const) };
}

describe('enqueue', () => {
  it('sends a valid payload through the app-role producer', async () => {
    const workspaceId = randomUUID();
    const id = await registry.enqueue(producer, 'system.ping', { workspaceId, nonce: 'n1' });

    expect(id).toEqual(expect.any(String));
    const [job] = await producer.findJobs('system.ping', { id: id ?? '' });
    expect(job?.data).toEqual({ workspaceId, nonce: 'n1' });
    expect(job?.groupId).toBe(workspaceId);
  });

  it('throws at the producer and never reaches the queue when the payload fails the schema', async () => {
    const sent: unknown[] = [];
    const spy: JobSender = {
      send: (name, data) => {
        sent.push({ name, data });
        return Promise.resolve('never');
      },
    };

    await expect(
      // @ts-expect-error: workspaceId must be a string uuid.
      registry.enqueue(spy, 'system.ping', { workspaceId: 42 }),
    ).rejects.toThrow(z.ZodError);
    await expect(
      enqueue('system.ping', { workspaceId: 'not-a-uuid' }, { sender: spy }),
    ).rejects.toThrow(z.ZodError);
    expect(sent).toEqual([]);

    const marker = randomUUID();
    await expect(
      registry.enqueue(producer, 'system.ping', { workspaceId: marker, nonce: '' }),
    ).rejects.toThrow(z.ZodError);
    expect(await producer.findJobs('system.ping', { data: { workspaceId: marker } })).toEqual([]);
  });

  it('is type-checked against the single registry map', () => {
    const spy: JobSender = { send: () => Promise.resolve(null) };
    const workspaceId = randomUUID();
    // Compile-time assertions (checked by `tsc --noEmit`); the calls themselves are not awaited.
    void registry.enqueue(spy, 'system.ping', { workspaceId });
    void enqueue('system.ping', { workspaceId }, { sender: spy });
    // @ts-expect-error: unknown job names are a compile error.
    void enqueue('system.unknown', { workspaceId }, { sender: spy }).catch(() => undefined);
    // @ts-expect-error: payload fields are checked per job.
    void enqueue('system.ping', { workspaceId, extra: 1 }, { sender: spy }).catch(() => undefined);
    expect(registry.definitions.map((d) => d.name)).toEqual([
      'system.ping',
      'system.retention.sweep',
      'system.billing.reconcile',
      'system.billing.dunning-tick',
      'billing.process-event',
      'billing.invoice-render',
      'billing.invoice-notice',
      'notification.deliver',
      'system.notification.digest',
      'notification.digest',
      'system.activity.digest',
      'activity.digest',
      'activity.digest.member',
      'system.usage.rollup',
      'system.audit.verify',
      'audit.verify',
      'system.audit.retention',
      'export.build',
      'system.export.expire',
      'system.support.session-expire',
      'system.deletion.tick',
      'deletion.erase',
      'account.delete',
      'memory.erase',
      'capture.scan',
      'capture.process',
      'system.capture.retention',
      'capture.retention',
      'whatsapp.import',
      'voice.process',
      'email.intake',
      'email.raw-expire',
      'extraction.extract-order',
      'import.batch',
      'import.file',
      'system.corpus.poll',
      'system.causelist.poll',
      'system.board.poll',
      'system.judgment-alert.scan',
    ]);
  });
});

describe('payload rules', () => {
  it('registered schemas declare identifiers only (no content, text, body, prompt, transcript)', () => {
    expect(contentFieldViolations(registry.definitions)).toEqual([]);
  });

  it('flags a schema that declares a content field, at any depth', () => {
    const bad = defineJob({
      name: 'test.bad-payload',
      schema: z.object({
        workspaceId: z.uuid(),
        transcript: z.string(),
        items: z.array(z.object({ body: z.string().optional() })),
      }),
      handler: () => Promise.resolve(),
    });
    expect(contentFieldViolations([bad])).toEqual([
      'test.bad-payload: transcript',
      'test.bad-payload: items[].body',
    ]);
    expect(() => createRegistry([bad] as const)).toThrow(/ids only/);
  });
});

describe('per-queue concurrency, singletonKey and fairness', () => {
  it('runs at most `concurrency` jobs at once (20 jobs, concurrency 2)', async () => {
    const { def, state, jobs } = trackingJob({ concurrency: 2 });
    await startTestWorker([def]);
    for (let i = 0; i < 20; i += 1) {
      // Distinct workspaces so fairness does not limit the run.
      await jobs.enqueue(producer, def.name, { workspaceId: randomUUID(), key: String(i) });
    }

    await waitFor(() => state.done === 20, { timeoutMs: 60_000 });
    expect(state.max).toBe(2);
  });

  it('honours singletonKey: one active job per key', async () => {
    const { def, state, jobs } = trackingJob({ concurrency: 4, singleton: true });
    await startTestWorker([def]);
    for (let i = 0; i < 4; i += 1) {
      await jobs.enqueue(producer, def.name, { workspaceId: randomUUID(), key: 'same' });
    }

    await waitFor(() => state.done === 4, { timeoutMs: 60_000 });
    expect(state.max).toBe(1);
  });

  it('caps concurrent jobs per explicit fairnessKey at the definition cap', async () => {
    const { def, state, jobs } = trackingJob({ concurrency: 6, fairnessConcurrency: 3, ms: 500 });
    await startTestWorker([def]);
    // An explicit fairnessKey group is not a workspace group, so the plan default (#221) does not
    // apply and the definition's cap of 3 holds.
    for (let i = 0; i < 9; i += 1) {
      await jobs.enqueue(producer, def.name, {
        workspaceId: randomUUID(),
        fairnessKey: 'shared-group',
        key: String(i),
      });
    }

    await waitFor(() => state.done === 9, { timeoutMs: 60_000 });
    expect(state.max).toBe(3);
  });

  it('caps a workspace group at its plan default (a workspace without a plan runs as Junior: 1)', async () => {
    const { def, state, jobs } = trackingJob({ concurrency: 6, fairnessConcurrency: 3, ms: 300 });
    await startTestWorker([def]);
    const workspaceId = randomUUID();
    for (let i = 0; i < 4; i += 1) {
      await jobs.enqueue(producer, def.name, { workspaceId, key: String(i) });
    }

    await waitFor(() => state.done === 4, { timeoutMs: 60_000 });
    expect(state.max).toBe(1);
  });
});
