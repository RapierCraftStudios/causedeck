// once() + job_effect: duplicate delivery produces one side effect (#15).
import { randomUUID } from 'node:crypto';

import { defineJob, once, runJob, systemPing } from '@causedeck/core/jobs';
import { schema, withWorkspace } from '@causedeck/db';
import { inWorkspace, testAppDb, withTestDb } from '@causedeck/db/testing';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { captureLogger, startTestWorker, stopTestWorkers, uniqueName, waitFor } from './helpers.ts';

afterEach(async () => {
  await stopTestWorkers();
});

/** `job_effect` is a tenant table under FORCE RLS (#19): read it inside the workspace's scope. */
async function effectsFor(workspaceId: string) {
  return withWorkspace(testAppDb(), { workspaceId }, (tx) =>
    tx.select().from(schema.jobEffect).where(eq(schema.jobEffect.workspaceId, workspaceId)),
  );
}

function countingJob() {
  const effects: string[] = [];
  const def = defineJob({
    name: uniqueName('effect'),
    schema: z.object({ workspaceId: z.uuid(), orderId: z.string() }),
    idempotencyKey: (p) => `order:${p.orderId}`,
    handler: async (ctx, payload) => {
      await once(ctx, ctx.idempotencyKey, () => {
        effects.push(payload.orderId);
        return Promise.resolve();
      });
    },
  });
  return { def, effects };
}

describe('once()', () => {
  it('applies the effect once when the same job is delivered twice', async () => {
    const { def, effects } = countingJob();
    const workspaceId = randomUUID();
    const job = { id: randomUUID(), data: { workspaceId, orderId: 'o-1' }, retryCount: 0 };
    const deps = { db: testAppDb(), logger: captureLogger().logger };

    await runJob(def, job, deps);
    await runJob(def, { ...job, retryCount: 1 }, deps);

    expect(effects).toEqual(['o-1']);
    expect(await effectsFor(workspaceId)).toHaveLength(1);
  });

  it('applies the effect once under concurrent duplicate delivery', async () => {
    const { def, effects } = countingJob();
    const workspaceId = randomUUID();
    const job = { id: randomUUID(), data: { workspaceId, orderId: 'o-2' }, retryCount: 0 };
    const deps = { db: testAppDb(), logger: captureLogger().logger };

    const outcomes = await Promise.all([runJob(def, job, deps), runJob(def, job, deps)]);

    expect(outcomes).toEqual([{ status: 'completed' }, { status: 'completed' }]);
    expect(effects).toEqual(['o-2']);
    expect(await effectsFor(workspaceId)).toHaveLength(1);
  });

  it('releases the claim when the effect fails, so a retry can apply it', async () => {
    let calls = 0;
    const def = defineJob({
      name: uniqueName('flaky'),
      schema: z.object({ workspaceId: z.uuid() }),
      handler: async (ctx) => {
        await once(ctx, 'k', () => {
          calls += 1;
          return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
        });
      },
    });
    const workspaceId = randomUUID();
    const job = { id: randomUUID(), data: { workspaceId }, retryCount: 0 };
    const deps = { db: testAppDb(), logger: captureLogger().logger };

    expect((await runJob(def, job, deps)).status).toBe('failed');
    expect(await effectsFor(workspaceId)).toHaveLength(0);
    expect((await runJob(def, { ...job, retryCount: 1 }, deps)).status).toBe('completed');
    expect(calls).toBe(2);
    expect(await effectsFor(workspaceId)).toHaveLength(1);
  });

  it('dedupes two queued system.ping jobs with the same nonce through a real worker', async () => {
    const worker = await startTestWorker([systemPing]);
    const workspaceId = randomUUID();
    await worker.boss.send('system.ping', { workspaceId, nonce: 'dup' });
    await worker.boss.send('system.ping', { workspaceId, nonce: 'dup' });

    await waitFor(async () => {
      const done = await worker.boss.findJobs('system.ping', { data: { workspaceId } });
      return done.length === 2 && done.every((j) => j.state === 'completed');
    });
    const rows = await effectsFor(workspaceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobName: 'system.ping', idempotencyKey: 'dup' });
  });
});

describe('job_effect', () => {
  it('rejects a duplicate (workspace, job, key) with a unique violation', async () => {
    await withTestDb(async (tx) => {
      const row = { jobName: 'test.dup', idempotencyKey: 'k', workspaceId: randomUUID() };
      await inWorkspace(tx, row.workspaceId, async (scoped) => {
        await scoped.insert(schema.jobEffect).values(row);
        await expect(
          scoped.transaction(async (sp) => {
            await sp.insert(schema.jobEffect).values(row);
          }),
        ).rejects.toMatchObject({ cause: { code: '23505' } });
      });
    });
  });
});
