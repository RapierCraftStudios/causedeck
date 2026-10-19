// Cron schedules: Asia/Kolkata, registered and sent once across two worker replicas (#15).
import { billingReconcile, defineJob, registry, retentionSweep } from '@causedeck/core/jobs';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { registerSchedules, SCHEDULE_TIMEZONE } from '../schedules.ts';

import { sleep, startTestWorker, stopTestWorkers, uniqueName, waitFor } from './helpers.ts';

const CRON_FAST = { cronWorkerIntervalSeconds: 1, cronMonitorIntervalSeconds: 1 };

afterAll(async () => {
  await stopTestWorkers();
});

describe('registerSchedules', () => {
  it('registers the daily system schedules in Asia/Kolkata', async () => {
    const worker = await startTestWorker([retentionSweep, billingReconcile]);
    expect(await registerSchedules(worker.boss, registry)).toEqual([
      'system.retention.sweep',
      'system.billing.reconcile',
    ]);

    const schedule = await worker.boss.getSchedule('system.retention.sweep');
    expect(schedule).toMatchObject({ cron: '30 3 * * *', timezone: 'Asia/Kolkata' });
    // 03:30 IST is 22:00 UTC the day before.
    const [next] = worker.boss.previewSchedule(schedule?.cron ?? '', {
      tz: SCHEDULE_TIMEZONE,
      from: new Date('2026-10-18T00:00:00Z'),
      count: 1,
    });
    expect(next?.toISOString()).toBe('2026-10-18T22:00:00.000Z');
    await worker.boss.unschedule('system.retention.sweep');

    // The billing reconcile runs daily at 04:00 IST (22:30 UTC the day before).
    const reconcile = await worker.boss.getSchedule('system.billing.reconcile');
    expect(reconcile).toMatchObject({ cron: '0 4 * * *', timezone: 'Asia/Kolkata' });
    const [nextReconcile] = worker.boss.previewSchedule(reconcile?.cron ?? '', {
      tz: SCHEDULE_TIMEZONE,
      from: new Date('2026-10-18T00:00:00Z'),
      count: 1,
    });
    expect(nextReconcile?.toISOString()).toBe('2026-10-18T22:30:00.000Z');
    await worker.boss.unschedule('system.billing.reconcile');
  });

  it('is registered once and sends each occurrence once with two worker replicas', async () => {
    let runs = 0;
    const def = defineJob({
      name: `system.${uniqueName('cron').slice('test.'.length)}`,
      schema: z.object({ workspaceId: z.null().optional() }),
      schedule: { cron: '* * * * *', payload: {} },
      handler: () => {
        runs += 1;
        return Promise.resolve();
      },
    });
    const definitions = [def];
    const a = await startTestWorker(definitions, { boss: CRON_FAST });
    const b = await startTestWorker(definitions, { boss: CRON_FAST });
    await Promise.all([
      registerSchedules(a.boss, { definitions }),
      registerSchedules(b.boss, { definitions }),
    ]);

    const schedules = await a.boss.getSchedules(def.name);
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.timezone).toBe('Asia/Kolkata');

    // Wait for the next minute's occurrence, then give both replicas several more cron passes.
    await waitFor(() => runs > 0, { timeoutMs: 75_000, intervalMs: 250 });
    await sleep(3000);
    const jobs = await a.boss.findJobs(def.name);
    const minutes = new Set(jobs.map((j) => Math.floor(j.createdOn.getTime() / 60_000)));
    expect(jobs.length).toBe(minutes.size);
    expect(runs).toBe(jobs.length);
    await a.boss.unschedule(def.name);
  }, 120_000);
});
