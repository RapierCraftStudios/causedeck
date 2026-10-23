// Cron schedules: Asia/Kolkata, registered and sent once across two worker replicas (#15).
import { defineJob, registry } from '@causedeck/core/jobs';
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
    const scheduled = registry.definitions.filter((def) => def.schedule !== undefined);
    const worker = await startTestWorker(scheduled);
    expect(await registerSchedules(worker.boss, registry)).toEqual([
      'system.retention.sweep',
      'system.billing.reconcile',
      'system.billing.dunning-tick',
      'system.notification.digest',
      'system.activity.digest',
      'system.usage.rollup',
      'system.business.cost-alert',
      'system.business.digest',
      'system.audit.verify',
      'system.audit.retention',
      'system.export.expire',
      'system.support.session-expire',
      'system.deletion.tick',
      'system.capture.retention',
      'system.corpus.poll',
      'system.causelist.poll',
      'system.judgment-alert.scan',
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

    // The digest scheduler runs every half hour in Asia/Kolkata, so it fires at 18:30 IST (13:00 UTC).
    const digest = await worker.boss.getSchedule('system.notification.digest');
    expect(digest).toMatchObject({ cron: '0,30 * * * *', timezone: 'Asia/Kolkata' });
    const [nextDigest] = worker.boss.previewSchedule(digest?.cron ?? '', {
      tz: SCHEDULE_TIMEZONE,
      from: new Date('2026-10-18T12:50:00Z'),
      count: 1,
    });
    expect(nextDigest?.toISOString()).toBe('2026-10-18T13:00:00.000Z');
    await worker.boss.unschedule('system.notification.digest');

    // The rest, each with its next firing from 2026-10-18T00:00Z (IST is UTC+05:30).
    const others = [
      // Dunning tick: daily 04:30 IST.
      ['system.billing.dunning-tick', '30 4 * * *', '2026-10-18T23:00:00.000Z'],
      // End-of-day digest scheduler (#49): every half hour from 18:00 to 23:30 IST; 18:00 IST is 12:30 UTC.
      ['system.activity.digest', '0,30 18-23 * * *', '2026-10-18T12:30:00.000Z'],
      // Usage rollup: hourly at :15 IST, which is :45 UTC.
      ['system.usage.rollup', '15 * * * *', '2026-10-18T00:45:00.000Z'],
      // Business cost alert (#519): daily 08:00 IST; digest: Mondays 09:00 IST (2026-10-19 is a Monday).
      ['system.business.cost-alert', '0 8 * * *', '2026-10-18T02:30:00.000Z'],
      ['system.business.digest', '0 9 * * 1', '2026-10-19T03:30:00.000Z'],
      // Audit chain verification: daily 02:00 IST.
      ['system.audit.verify', '0 2 * * *', '2026-10-18T20:30:00.000Z'],
      // Audit retention: daily 03:00 IST.
      ['system.audit.retention', '0 3 * * *', '2026-10-18T21:30:00.000Z'],
      // Capture raw-object retention: daily 02:00 IST.
      ['system.capture.retention', '0 2 * * *', '2026-10-18T20:30:00.000Z'],
      // KHC cause-list poll (#482): 07:30 and 18:30 IST; 07:30 IST is 02:00 UTC.
      ['system.causelist.poll', '30 7,18 * * *', '2026-10-18T02:00:00.000Z'],
    ] as const;
    for (const [name, cron, firstRun] of others) {
      const row = await worker.boss.getSchedule(name);
      expect(row, name).toMatchObject({ cron, timezone: 'Asia/Kolkata' });
      const [first] = worker.boss.previewSchedule(row?.cron ?? '', {
        tz: SCHEDULE_TIMEZONE,
        from: new Date('2026-10-18T00:00:00Z'),
        count: 1,
      });
      expect(first?.toISOString(), name).toBe(firstRun);
      await worker.boss.unschedule(name);
    }
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
