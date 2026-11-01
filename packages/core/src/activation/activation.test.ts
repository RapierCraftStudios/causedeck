// Activation events and the funnel (#509): first occurrence only, weekly cohorts in India time,
// channel filter, time to first court-day view, and the privacy shape of the table. Seeded at
// fixed 2031 instants and read with `since`, so rows committed by other suites never count.
import { schema, type Transaction } from '@causedeck/db';
import { withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { getTableColumns, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { discoveredVsConfirmed, funnelByCohort, timeToFirstCourtDay } from './funnel.ts';
import { ACTIVATION_CHANNELS, ACTIVATION_STEPS, recordActivation } from './record.ts';

const SINCE = new Date('2031-01-01T00:00:00Z');
const MON_1 = new Date('2031-03-03T06:00:00Z'); // Monday 11:30 IST
const MON_2 = new Date('2031-03-10T06:00:00Z');
const hours = (from: Date, h: number) => new Date(from.getTime() + h * 3_600_000);

async function users(tx: Transaction) {
  const t = await seedTwoTenants(tx);
  return [t.ua, t.ub, t.uboth] as const;
}

describe('recordActivation', () => {
  it('counts a step once per user: the first occurrence wins', async () => {
    await withTestDb(async (tx) => {
      const [u] = await users(tx);
      expect(await recordActivation(tx, { userId: u, step: 'signed_up', at: MON_1 })).toBe(true);
      expect(await recordActivation(tx, { userId: u, step: 'signed_up', at: MON_2 })).toBe(false);
      const rows = await tx
        .select()
        .from(schema.activationEvent)
        .where(sql`user_id = ${u}`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.occurredAt).toEqual(MON_1);
    });
  });

  it('stores the counts on the first insert and a repeat does not overwrite them (#699)', async () => {
    await withTestDb(async (tx) => {
      const [u] = await users(tx);
      await recordActivation(tx, {
        userId: u,
        step: 'confirm_grid_done',
        discovered: 12,
        confirmed: 9,
        at: MON_1,
      });
      await recordActivation(tx, {
        userId: u,
        step: 'confirm_grid_done',
        discovered: 99,
        confirmed: 99,
        at: MON_2,
      });
      const [row] = await tx
        .select()
        .from(schema.activationEvent)
        .where(sql`user_id = ${u} and step = 'confirm_grid_done'`);
      expect([row?.mattersDiscovered, row?.mattersConfirmed]).toEqual([12, 9]);
    });
  });

  it('leaves the counts null when none or an invalid one is passed (#699)', async () => {
    await withTestDb(async (tx) => {
      const [u] = await users(tx);
      await recordActivation(tx, { userId: u, step: 'signed_up', at: MON_1 });
      await recordActivation(tx, {
        userId: u,
        step: 'discovery_found',
        discovered: -3,
        confirmed: 1.5,
        at: MON_1,
      });
      const rows = await tx
        .select()
        .from(schema.activationEvent)
        .where(sql`user_id = ${u}`);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect([row.mattersDiscovered, row.mattersConfirmed]).toEqual([null, null]);
      }
    });
  });

  it('never throws: a failed write is reported and returns false', async () => {
    await withTestDb(async (tx) => {
      const errors: unknown[] = [];
      const ok = await recordActivation(
        tx,
        { userId: '00000000-0000-4000-8000-000000000000', step: 'signed_up' },
        (e) => errors.push(e),
      );
      expect(ok).toBe(false);
      expect(errors).toHaveLength(1);
    });
  });

  it('accepts the education channel for learn-module signups (#511)', async () => {
    expect(ACTIVATION_CHANNELS).toContain('education');
    await withTestDb(async (tx) => {
      const [u] = await users(tx);
      const ok = await recordActivation(tx, { userId: u, step: 'signed_up', channel: 'education' });
      expect(ok).toBe(true);
    });
  });

  it('rejects a step or channel outside the catalogue at the database', async () => {
    await withTestDb(async (tx) => {
      const [u] = await users(tx);
      await expect(
        tx.transaction((s) =>
          s.insert(schema.activationEvent).values({ userId: u, step: 'opened_matter' as never }),
        ),
      ).rejects.toThrow();
      await expect(
        tx.transaction((s) =>
          s
            .insert(schema.activationEvent)
            .values({ userId: u, step: 'signed_up', channel: 'a@b.in' as never }),
        ),
      ).rejects.toThrow();
    });
  });
});

describe('activation_event carries no content or personal data', () => {
  it('has only the user id, a step, a channel, a timestamp and two integer counts', () => {
    expect(Object.keys(getTableColumns(schema.activationEvent)).sort()).toEqual([
      'channel',
      'id',
      'mattersConfirmed',
      'mattersDiscovered',
      'occurredAt',
      'step',
      'userId',
    ]);
  });

  it('limits step and channel to closed lists of identifiers', () => {
    for (const value of [...ACTIVATION_STEPS, ...ACTIVATION_CHANNELS]) {
      expect(value).toMatch(/^[a-z_]+$/);
    }
    expect(ACTIVATION_STEPS).toEqual([
      'signed_up',
      'workspace_created',
      'identifiers_entered',
      'discovery_found',
      'confirm_grid_done',
      'first_court_day_view',
      'first_alert',
      'first_brief',
      'whatsapp_linked',
      'invite_sent',
    ]);
  });
});

describe('funnel by weekly cohort', () => {
  it('reports step conversion per cohort week and time to first court-day view', async () => {
    await withTestDb(async (tx) => {
      const [u1, u2, u3] = await users(tx);
      // Week 1: u1 and u2 sign up; u1 reaches the court-day view 5 h later, u2 stops after a workspace.
      await recordActivation(tx, { userId: u1, step: 'signed_up', channel: 'whatsapp', at: MON_1 });
      await recordActivation(tx, { userId: u1, step: 'first_court_day_view', at: hours(MON_1, 5) });
      await recordActivation(tx, { userId: u2, step: 'signed_up', channel: 'search', at: MON_1 });
      await recordActivation(tx, { userId: u2, step: 'workspace_created', at: hours(MON_1, 1) });
      // Week 2: u3 signs up and views the court day after 1 day.
      await recordActivation(tx, { userId: u3, step: 'signed_up', channel: 'whatsapp', at: MON_2 });
      await recordActivation(tx, {
        userId: u3,
        step: 'first_court_day_view',
        at: hours(MON_2, 24),
      });

      const cohorts = await funnelByCohort(tx, { since: SINCE });
      expect(cohorts.map((c) => [c.week, c.signedUp])).toEqual([
        ['2031-03-03', 2],
        ['2031-03-10', 1],
      ]);
      const conv = (week: string, step: string) =>
        cohorts.find((c) => c.week === week)?.steps.find((s) => s.step === step);
      expect(conv('2031-03-03', 'first_court_day_view')).toMatchObject({
        users: 1,
        conversion: 0.5,
      });
      expect(conv('2031-03-03', 'workspace_created')).toMatchObject({ users: 1, conversion: 0.5 });
      expect(conv('2031-03-03', 'first_alert')).toMatchObject({ users: 0, conversion: 0 });
      expect(conv('2031-03-10', 'first_court_day_view')).toMatchObject({ users: 1, conversion: 1 });
      expect(cohorts[0]?.steps.map((s) => s.step)).toEqual([...ACTIVATION_STEPS]);

      const ttv = await timeToFirstCourtDay(tx, { since: SINCE });
      expect(ttv).toEqual([
        { week: '2031-03-03', reached: 1, medianSeconds: 5 * 3600, p90Seconds: 5 * 3600 },
        { week: '2031-03-10', reached: 1, medianSeconds: 24 * 3600, p90Seconds: 24 * 3600 },
      ]);
    });
  });

  it('filters by channel and cuts weeks at Monday 00:00 India time', async () => {
    await withTestDb(async (tx) => {
      const [u1, u2] = await users(tx);
      // Sunday 20:00 UTC is Monday 01:30 IST: the next cohort week.
      await recordActivation(tx, {
        userId: u1,
        step: 'signed_up',
        channel: 'whatsapp',
        at: new Date('2031-03-09T20:00:00Z'),
      });
      await recordActivation(tx, { userId: u2, step: 'signed_up', channel: 'search', at: MON_1 });
      expect((await funnelByCohort(tx, { since: SINCE })).map((c) => c.week)).toEqual([
        '2031-03-03',
        '2031-03-10',
      ]);
      const whatsapp = await funnelByCohort(tx, { since: SINCE, channel: 'whatsapp' });
      expect(whatsapp.map((c) => [c.week, c.signedUp])).toEqual([['2031-03-10', 1]]);
    });
  });

  it('sums matters discovered against confirmed per cohort week, over users with both (#699)', async () => {
    await withTestDb(async (tx) => {
      const [u1, u2, u3] = await users(tx);
      for (const [u, at] of [
        [u1, MON_1],
        [u2, MON_1],
        [u3, MON_2],
      ] as const) {
        await recordActivation(tx, { userId: u, step: 'signed_up', at });
      }
      await recordActivation(tx, {
        userId: u1,
        step: 'confirm_grid_done',
        discovered: 10,
        confirmed: 8,
        at: hours(MON_1, 2),
      });
      await recordActivation(tx, {
        userId: u2,
        step: 'confirm_grid_done',
        discovered: 6,
        confirmed: 2,
        at: hours(MON_1, 3),
      });
      // No counts recorded: not part of the aggregate.
      await recordActivation(tx, { userId: u3, step: 'confirm_grid_done', at: hours(MON_2, 1) });

      expect(await discoveredVsConfirmed(tx, { since: SINCE })).toEqual([
        { week: '2031-03-03', users: 2, discovered: 16, confirmed: 10, ratio: 10 / 16 },
      ]);
    });
  });

  it('returns only counts and durations, never a user id', async () => {
    await withTestDb(async (tx) => {
      const [u1] = await users(tx);
      await recordActivation(tx, { userId: u1, step: 'signed_up', at: MON_1 });
      const out = JSON.stringify([
        await funnelByCohort(tx, { since: SINCE }),
        await timeToFirstCourtDay(tx, { since: SINCE }),
        await discoveredVsConfirmed(tx, { since: SINCE }),
      ]);
      expect(out).not.toContain(u1);
    });
  });
});
