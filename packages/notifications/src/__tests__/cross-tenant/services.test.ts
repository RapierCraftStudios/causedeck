// Cross-tenant notifications services (#194, #19): user `ub` (owner of B) calls every exported
// `@causedeck/notifications` service against workspace A (A as the context workspace, or A's ids
// from B's context) and gets FORBIDDEN or NOT_FOUND, and A's notification and preference rows are
// unchanged afterwards. Driven by NOTIFICATION_SERVICE_TESTS, so a registered service without a
// case here fails.
import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { NOTIFICATION_SERVICE_TESTS } from '@causedeck/db/testing/cross-tenant-registry';
import { seedTwoTenants, type TwoTenants } from '@causedeck/db/testing/two-tenants';
import { describe, expect, it } from 'vitest';

import * as notifications from '../../index.ts';
import type { DeliveryJob, NotifyContext } from '../../index.ts';

const THIS_FILE = 'packages/notifications/src/__tests__/cross-tenant/services.test.ts';

interface Fixture extends TwoTenants {
  tx: Transaction;
  jobs: DeliveryJob[];
  /** Context on workspace A / B (the caller passes `ub` as the user). */
  inA: NotifyContext;
  inB: NotifyContext;
  /** A's seeded notification (owned by `ua`). */
  aNotificationId: string;
}

async function expectDenied(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'expected NOT_FOUND or FORBIDDEN').toBeInstanceOf(notifications.NotificationError);
  expect(['NOT_FOUND', 'FORBIDDEN']).toContain((error as notifications.NotificationError).code);
}

/** A's notification and preference rows, to compare before and after. */
async function aState(f: Fixture) {
  return inWorkspace(f.tx, f.a.id, async (s) => ({
    notifications: await s.select().from(schema.notification).orderBy(schema.notification.id),
    prefs: await s.select().from(schema.notificationPref),
  }));
}

type Case = (f: Fixture) => Promise<void>;

const CASES: Record<string, Case> = {
  notify: async (f) => {
    await expectDenied(
      notifications.notify(f.inA, { userId: f.ub, category: 'security.alert', title: 'x' }),
    );
    // A's member cannot be notified from B's context either.
    await expectDenied(
      notifications.notify(f.inB, { userId: f.ua, category: 'security.alert', title: 'x' }),
    );
    expect(f.jobs).toEqual([]);
  },
  listForUser: async (f) => {
    await expectDenied(notifications.listForUser(f.inA, { userId: f.ub }));
    await expectDenied(notifications.listForUser(f.inB, { userId: f.ua }));
    const mine = await notifications.listForUser(f.inB, { userId: f.ub });
    expect(mine.map((n) => n.id)).not.toContain(f.aNotificationId);
    expect(mine).toHaveLength(1);
  },
  markRead: async (f) => {
    await expectDenied(
      notifications.markRead(f.inA, { userId: f.ub, notificationId: f.aNotificationId }),
    );
    await expectDenied(
      notifications.markRead(f.inB, { userId: f.ub, notificationId: f.aNotificationId }),
    );
  },
  markAllRead: async (f) => {
    await expectDenied(notifications.markAllRead(f.inA, { userId: f.ub }));
    expect(await notifications.markAllRead(f.inB, { userId: f.ub })).toBe(1);
  },
  unreadCount: async (f) => {
    await expectDenied(notifications.unreadCount(f.inA, { userId: f.ub }));
    expect(await notifications.unreadCount(f.inB, { userId: f.ub })).toBe(1);
  },
  getPreferences: async (f) => {
    await expectDenied(notifications.getPreferences(f.inA, { userId: f.ub }));
    await expectDenied(notifications.getPreferences(f.inB, { userId: f.ua }));
  },
  setPreference: async (f) => {
    await expectDenied(
      notifications.setPreference(f.inA, {
        userId: f.ub,
        category: 'system.notice',
        channel: 'email',
        enabled: true,
      }),
    );
    await expectDenied(
      notifications.setPreference(f.inB, {
        userId: f.ua,
        category: 'system.notice',
        channel: 'email',
        enabled: true,
      }),
    );
  },
  getNotificationSetting: async (f) => {
    await expectDenied(notifications.getNotificationSetting(f.inA, { userId: f.ub }));
    await expectDenied(notifications.getNotificationSetting(f.inB, { userId: f.ua }));
  },
  setLockScreenDetails: async (f) => {
    await expectDenied(notifications.setLockScreenDetails(f.inA, { userId: f.ub, enabled: true }));
    await expectDenied(notifications.setLockScreenDetails(f.inB, { userId: f.ua, enabled: true }));
    const settings = await inWorkspace(f.tx, f.a.id, (s) =>
      s.select().from(schema.notificationSetting),
    );
    expect(settings.filter((r) => r.userId === f.ub)).toEqual([]);
  },
};

const registered = Object.entries(NOTIFICATION_SERVICE_TESTS)
  .filter(([, entry]) => entry.test === THIS_FILE)
  .map(([name]) => name);

describe('cross-tenant notifications services: ub on workspace B against A', () => {
  it('has a case for every service the registry points here', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((name) => !(name in CASES))).toEqual([]);
    expect(Object.keys(CASES).filter((name) => !(name in NOTIFICATION_SERVICE_TESTS))).toEqual([]);
  });

  it.each(registered)('%s', async (name) => {
    const run = CASES[name];
    if (run === undefined) throw new Error(`no cross-tenant case for ${name}`);
    await withTestDb(async (tx) => {
      const seeded = await seedTwoTenants(tx);
      const aNotificationId = seeded.a.rows.notification?.notificationId;
      if (aNotificationId === undefined) throw new Error('two-tenant notification seed missing');
      const jobs: DeliveryJob[] = [];
      const enqueueDelivery = (job: DeliveryJob) => {
        jobs.push(job);
        return Promise.resolve();
      };
      const f: Fixture = {
        ...seeded,
        tx,
        jobs,
        inA: { db: tx, workspaceId: seeded.a.id, enqueueDelivery },
        inB: { db: tx, workspaceId: seeded.b.id, enqueueDelivery },
        aNotificationId,
      };
      const before = await aState(f);
      expect(before.notifications).toHaveLength(1);
      expect(before.prefs).toHaveLength(1);
      await run(f);
      expect(await aState(f)).toEqual(before);
    });
  });
});
