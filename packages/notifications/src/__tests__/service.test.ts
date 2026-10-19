// The notifications service (#194): preferences decide which deliveries are enqueued,
// `security.alert` cannot be silenced in-app or by email, recipients must be active members, and
// every read and mark touches only the member's own rows. Rolled back per test (`withTestDb`).
import { randomUUID } from 'node:crypto';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { seedTwoTenants } from '@causedeck/db/testing/two-tenants';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import * as notifications from '../index.ts';
import {
  getPreferences,
  listForUser,
  markAllRead,
  markRead,
  NotificationError,
  notify,
  setPreference,
  unreadCount,
  type DeliveryJob,
  type NotifyContext,
} from '../index.ts';

interface Fixture {
  tx: Transaction;
  workspaceId: string;
  /** A fresh active member of workspace A with no preference rows. */
  userId: string;
  ctx: NotifyContext;
  jobs: DeliveryJob[];
  addMember: (status?: 'active' | 'suspended' | 'removed') => Promise<string>;
  rows: (userId: string) => Promise<(typeof schema.notification.$inferSelect)[]>;
}

async function setup(tx: Transaction): Promise<Fixture> {
  const { a } = await seedTwoTenants(tx);
  const addMember = async (status: 'active' | 'suspended' | 'removed' = 'active') => {
    const [u] = await tx
      .insert(schema.user)
      .values({ name: 'Member', email: `m-${randomUUID()}@example.test` })
      .returning({ id: schema.user.id });
    if (!u) throw new Error('user insert failed');
    await inWorkspace(tx, a.id, (s) =>
      s
        .insert(schema.member)
        .values({ organizationId: a.id, userId: u.id, role: 'junior', status }),
    );
    return u.id;
  };
  const jobs: DeliveryJob[] = [];
  const userId = await addMember();
  return {
    tx,
    workspaceId: a.id,
    userId,
    jobs,
    addMember,
    ctx: {
      db: tx,
      workspaceId: a.id,
      enqueueDelivery: (job) => {
        jobs.push(job);
        return Promise.resolve();
      },
    },
    rows: (uid) =>
      inWorkspace(tx, a.id, (s) =>
        s.select().from(schema.notification).where(eq(schema.notification.userId, uid)),
      ),
  };
}

const run = (fn: (f: Fixture) => Promise<void>) => withTestDb(async (tx) => fn(await setup(tx)));

async function errorOf(promise: Promise<unknown>): Promise<NotificationError> {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(NotificationError);
  return error as NotificationError;
}

describe('notify: channels and preferences', () => {
  it('writes the in-app row and enqueues the category default channels', async () => {
    await run(async (f) => {
      await notify(f.ctx, {
        userId: f.userId,
        category: 'reminder.hearing',
        title: 'Hearing tomorrow',
        href: '/w/x/matters/1',
      });
      const rows = await f.rows(f.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ category: 'reminder.hearing', title: 'Hearing tomorrow' });
      const id = rows[0]?.id;
      expect(f.jobs).toEqual([
        { workspaceId: f.workspaceId, notificationId: id, channel: 'email' },
        { workspaceId: f.workspaceId, notificationId: id, channel: 'push' },
      ]);
    });
  });

  it('enqueues nothing for an in-app-only category', async () => {
    await run(async (f) => {
      await notify(f.ctx, { userId: f.userId, category: 'system.notice', title: 'Maintenance' });
      expect(await f.rows(f.userId)).toHaveLength(1);
      expect(f.jobs).toEqual([]);
    });
  });

  it('enqueues only the channels the recipient has enabled', async () => {
    await run(async (f) => {
      const base = { userId: f.userId, category: 'reminder.hearing' } as const;
      await setPreference(f.ctx, { ...base, channel: 'email', enabled: false });
      await notify(f.ctx, { ...base, title: 'One' });
      expect(f.jobs.map((j) => j.channel)).toEqual(['push']);

      f.jobs.length = 0;
      await setPreference(f.ctx, { ...base, channel: 'push', enabled: false });
      await setPreference(f.ctx, { ...base, channel: 'email', enabled: true, digest: 'daily' });
      await notify(f.ctx, { ...base, title: 'Two' });
      expect(f.jobs).toEqual([]);

      f.jobs.length = 0;
      await setPreference(f.ctx, { ...base, channel: 'email', digest: 'instant' });
      await setPreference(f.ctx, {
        userId: f.userId,
        category: 'proposal.new',
        channel: 'email',
        enabled: true,
      });
      await notify(f.ctx, { ...base, title: 'Three' });
      await notify(f.ctx, { userId: f.userId, category: 'proposal.new', title: 'Four' });
      expect(f.jobs.map((j) => j.channel)).toEqual(['email', 'email', 'push']);
    });
  });

  it('security.alert cannot be disabled in-app or by email', async () => {
    await run(async (f) => {
      const base = { userId: f.userId, category: 'security.alert' } as const;
      for (const channel of ['in_app', 'email'] as const) {
        expect(
          (await errorOf(setPreference(f.ctx, { ...base, channel, enabled: false }))).code,
        ).toBe('VALIDATION');
        expect(
          (await errorOf(setPreference(f.ctx, { ...base, channel, digest: 'off' }))).code,
        ).toBe('VALIDATION');
      }
      // Rows written behind the service's back are ignored for locked channels.
      await inWorkspace(f.tx, f.workspaceId, (s) =>
        s.insert(schema.notificationPref).values([
          {
            workspaceId: f.workspaceId,
            userId: f.userId,
            category: 'security.alert',
            channel: 'in_app',
            enabled: false,
          },
          {
            workspaceId: f.workspaceId,
            userId: f.userId,
            category: 'security.alert',
            channel: 'email',
            enabled: false,
          },
        ]),
      );
      // Push stays the member's choice.
      await setPreference(f.ctx, { ...base, channel: 'push', enabled: false });

      await notify(f.ctx, { ...base, title: 'New sign-in' });
      expect(f.jobs.map((j) => j.channel)).toEqual(['email']);
      expect((await listForUser(f.ctx, { userId: f.userId })).map((n) => n.title)).toEqual([
        'New sign-in',
      ]);
      expect(await unreadCount(f.ctx, { userId: f.userId })).toBe(1);

      const prefs = await getPreferences(f.ctx, { userId: f.userId });
      expect(prefs.filter((p) => p.category === 'security.alert')).toEqual([
        {
          category: 'security.alert',
          channel: 'in_app',
          enabled: true,
          digest: 'instant',
          locked: true,
        },
        {
          category: 'security.alert',
          channel: 'email',
          enabled: true,
          digest: 'instant',
          locked: true,
        },
        {
          category: 'security.alert',
          channel: 'push',
          enabled: false,
          digest: 'instant',
          locked: false,
        },
      ]);
    });
  });

  it('dedupes by dedupe_key per member: one row, one set of deliveries', async () => {
    await run(async (f) => {
      const n = {
        category: 'billing.notice',
        title: 'Invoice ready',
        dedupeKey: 'inv-42',
      } as const;
      await notify(f.ctx, { ...n, userId: f.userId });
      await notify(f.ctx, { ...n, userId: f.userId });
      expect(await f.rows(f.userId)).toHaveLength(1);
      expect(f.jobs).toHaveLength(1);

      const other = await f.addMember();
      await notify(f.ctx, { ...n, userId: other });
      expect(await f.rows(other)).toHaveLength(1);
      expect(f.jobs).toHaveLength(2);

      // Without a key nothing is deduped.
      await notify(f.ctx, { userId: f.userId, category: 'system.notice', title: 'x' });
      await notify(f.ctx, { userId: f.userId, category: 'system.notice', title: 'x' });
      expect(await f.rows(f.userId)).toHaveLength(3);
    });
  });
});

describe('notify: recipients', () => {
  it('throws FORBIDDEN for a non-member and writes or enqueues nothing', async () => {
    await run(async (f) => {
      const [stranger] = await f.tx
        .insert(schema.user)
        .values({ name: 'Stranger', email: `s-${randomUUID()}@example.test` })
        .returning({ id: schema.user.id });
      if (!stranger) throw new Error('user insert failed');
      const error = await errorOf(
        notify(f.ctx, { userId: stranger.id, category: 'security.alert', title: 'x' }),
      );
      expect(error.code).toBe('FORBIDDEN');
      expect(await f.rows(stranger.id)).toEqual([]);
      expect(f.jobs).toEqual([]);
    });
  });

  it.each(['suspended', 'removed'] as const)('throws FORBIDDEN for a %s member', async (status) => {
    await run(async (f) => {
      const uid = await f.addMember(status);
      const error = await errorOf(
        notify(f.ctx, { userId: uid, category: 'system.notice', title: 'x' }),
      );
      expect(error.code).toBe('FORBIDDEN');
      expect(await f.rows(uid)).toEqual([]);
    });
  });

  it('accepts a userId only: no address, no unknown fields, no external links', async () => {
    await run(async (f) => {
      const bad: unknown[] = [
        { userId: f.userId, category: 'system.notice', title: 'x', to: 'someone@example.com' },
        { userId: f.userId, category: 'system.notice', title: 'x', email: 'someone@example.com' },
        { userId: 'someone@example.com', category: 'system.notice', title: 'x' },
        { userId: f.userId, category: 'client.update', title: 'x' },
        { userId: f.userId, category: 'system.notice', title: 'x', href: 'https://evil.test' },
        { userId: f.userId, category: 'system.notice', title: 'x', href: '//evil.test' },
        { userId: f.userId, category: 'system.notice', title: '' },
      ];
      for (const input of bad) {
        const error = await errorOf(notify(f.ctx, input as Parameters<typeof notify>[1]));
        expect(error.code).toBe('VALIDATION');
      }
      expect(await f.rows(f.userId)).toEqual([]);
      expect(f.jobs).toEqual([]);
    });
  });

  it('exports no API that sends to an arbitrary address', () => {
    const names = Object.keys(notifications);
    expect(names.filter((n) => /mail|send|address|deliver/i.test(n))).toEqual([]);
  });
});

describe('in-app list, read state and preferences', () => {
  it('lists, counts and marks only the member own rows', async () => {
    await run(async (f) => {
      const other = await f.addMember();
      for (const title of ['first', 'second']) {
        await notify(f.ctx, { userId: f.userId, category: 'system.notice', title });
      }
      await notify(f.ctx, { userId: other, category: 'system.notice', title: 'theirs' });

      const mine = await listForUser(f.ctx, { userId: f.userId });
      expect(mine.map((n) => n.title)).toEqual(['second', 'first']);
      expect(await unreadCount(f.ctx, { userId: f.userId })).toBe(2);
      expect(await listForUser(f.ctx, { userId: f.userId, limit: 1 })).toHaveLength(1);

      const [theirs] = await listForUser(f.ctx, { userId: other });
      if (!theirs) throw new Error('missing row');
      expect(
        (await errorOf(markRead(f.ctx, { userId: f.userId, notificationId: theirs.id }))).code,
      ).toBe('NOT_FOUND');
      expect(
        (await errorOf(markRead(f.ctx, { userId: f.userId, notificationId: 'nope' }))).code,
      ).toBe('NOT_FOUND');

      const [newest] = mine;
      if (!newest) throw new Error('missing row');
      await markRead(f.ctx, { userId: f.userId, notificationId: newest.id });
      expect(await unreadCount(f.ctx, { userId: f.userId })).toBe(1);
      expect(await markAllRead(f.ctx, { userId: f.userId })).toBe(1);
      expect(await unreadCount(f.ctx, { userId: f.userId })).toBe(0);
      expect(await unreadCount(f.ctx, { userId: other })).toBe(1);

      const [theirRow] = await f.rows(other);
      expect(theirRow?.readAt).toBeNull();
    });
  });

  it('hides categories whose in-app channel is off from the list and count', async () => {
    await run(async (f) => {
      await notify(f.ctx, { userId: f.userId, category: 'member.joined', title: 'Asha joined' });
      expect(await unreadCount(f.ctx, { userId: f.userId })).toBe(1);
      await setPreference(f.ctx, {
        userId: f.userId,
        category: 'member.joined',
        channel: 'in_app',
        enabled: false,
      });
      expect(await listForUser(f.ctx, { userId: f.userId })).toEqual([]);
      expect(await unreadCount(f.ctx, { userId: f.userId })).toBe(0);
    });
  });

  it('returns the full matrix with defaults and persists changes', async () => {
    await run(async (f) => {
      const prefs = await getPreferences(f.ctx, { userId: f.userId });
      expect(prefs).toHaveLength(
        notifications.CATEGORY_KEYS.length * notifications.CHANNELS.length,
      );
      expect(
        prefs.find((p) => p.category === 'member.joined' && p.channel === 'email'),
      ).toMatchObject({ enabled: false, digest: 'instant', locked: false });
      const set = await setPreference(f.ctx, {
        userId: f.userId,
        category: 'member.joined',
        channel: 'email',
        enabled: true,
        digest: 'daily',
      });
      expect(set).toEqual({
        category: 'member.joined',
        channel: 'email',
        enabled: true,
        digest: 'daily',
        locked: false,
      });
      const again = await setPreference(f.ctx, {
        userId: f.userId,
        category: 'member.joined',
        channel: 'email',
        enabled: false,
      });
      expect(again.digest).toBe('daily');
      const stored = await inWorkspace(f.tx, f.workspaceId, (s) =>
        s
          .select()
          .from(schema.notificationPref)
          .where(
            and(
              eq(schema.notificationPref.userId, f.userId),
              eq(schema.notificationPref.category, 'member.joined'),
            ),
          ),
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ channel: 'email', enabled: false, digest: 'daily' });
    });
  });
});
