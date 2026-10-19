// `notification.deliver` (#196) on the Testcontainers database, as causedeck_app in a rolled-back
// transaction with a recording email transport: one send per notification and channel, retry with
// backoff on transient failures, a permanent SES failure recorded as failed (no retry, no new
// in-app row), and suppressed addresses never reaching the transport.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { schema, type Database, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { recordSuppression, type EmailMessage } from '@causedeck/notifications/email';
import {
  createPushSender,
  generateVapidKeys,
  GENERIC_PUSH_TITLES,
  saveSubscription,
  type WebPushClient,
} from '@causedeck/notifications/push';
import { Secret } from '@causedeck/config/env';
import { createLogger } from '@causedeck/observability';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { runJob, type JobContext } from '../context.ts';
import { registry } from '../registry.ts';
import {
  deliveryKey,
  notificationDeliver,
  runNotificationDeliver,
  setNotificationJobDeps,
  type NotificationDeliverPayload,
  type NotificationJobDeps,
} from './notification-deliver.ts';

const APP_URL = 'https://app.causedeck.test';
const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

const sesError = (name: string, status: number) =>
  Object.assign(new Error(`${name} for someone@example.test`), {
    name,
    $metadata: { httpStatusCode: status },
  });

/** A transport that records messages and fails with `failWith` while it is set. */
function transport() {
  const sent: EmailMessage[] = [];
  const state: { failWith: Error | undefined } = { failWith: undefined };
  const deps: NotificationJobDeps = {
    appUrl: APP_URL,
    email: {
      provider: 'console',
      send: (message) => {
        if (state.failWith !== undefined) return Promise.reject(state.failWith);
        sent.push(message);
        return Promise.resolve({ messageId: `m-${String(sent.length)}` });
      },
    },
  };
  return { sent, state, deps };
}

interface Fixture {
  tx: Transaction;
  workspaceId: string;
  userId: string;
  email: string;
  addNotification: (input?: { category?: string; userId?: string }) => Promise<string>;
  rows: () => Promise<(typeof schema.notification.$inferSelect)[]>;
  ctx: (payload: NotificationDeliverPayload, scoped: Transaction) => JobContext;
  inWs: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
}

async function setup(tx: Transaction): Promise<Fixture> {
  const workspaceId = randomUUID();
  const email = `m-${randomUUID()}@example.test`;
  const [u] = await tx
    .insert(schema.user)
    .values({ name: 'Member', email })
    .returning({ id: schema.user.id });
  if (!u) throw new Error('user insert failed');
  const inWs = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, workspaceId, fn);
  await inWs(async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Deliver', slug: `deliver-${workspaceId}` });
    await s
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId: u.id, role: 'owner' });
  });
  return {
    tx,
    workspaceId,
    userId: u.id,
    email,
    inWs,
    addNotification: async ({ category = 'reminder.hearing', userId = u.id } = {}) =>
      inWs(async (s) => {
        const [row] = await s
          .insert(schema.notification)
          .values({ workspaceId, userId, category, title: 'Hearing tomorrow', href: '/w/x/m/1' })
          .returning({ id: schema.notification.id });
        if (!row) throw new Error('notification insert failed');
        return row.id;
      }),
    rows: () =>
      inWs((s) => s.select().from(schema.notification).where(eq(schema.notification.userId, u.id))),
    ctx: (payload, scoped) => ({
      log: logger,
      db: scoped,
      workspaceId,
      jobName: 'notification.deliver',
      jobId: randomUUID(),
      attempt: 1,
      signal: new AbortController().signal,
      idempotencyKey: deliveryKey(payload),
    }),
  };
}

const run = (fn: (f: Fixture) => Promise<void>) => withTestDb(async (tx) => fn(await setup(tx)));

/** Run the handler directly inside the workspace scope. */
function deliver(f: Fixture, payload: NotificationDeliverPayload, deps: NotificationJobDeps) {
  return f.inWs((s) => runNotificationDeliver(f.ctx(payload, s), payload, deps));
}

/** Run through `runJob`, as the worker does, with `deps` installed. */
function deliverJob(f: Fixture, payload: NotificationDeliverPayload, deps: NotificationJobDeps) {
  setNotificationJobDeps(deps);
  return runJob(
    notificationDeliver,
    { id: randomUUID(), data: payload, retryCount: 0 },
    { db: f.tx as unknown as Database, logger },
  );
}

async function deliveryOf(f: Fixture, notificationId: string) {
  const [row] = await f.inWs((s) =>
    s
      .select({ data: schema.notification.data })
      .from(schema.notification)
      .where(eq(schema.notification.id, notificationId)),
  );
  return (row?.data as { delivery?: Record<string, Record<string, unknown>> }).delivery;
}

async function claims(f: Fixture, key: string) {
  return f.inWs((s) =>
    s
      .select({ id: schema.jobEffect.id })
      .from(schema.jobEffect)
      .where(
        and(
          eq(schema.jobEffect.jobName, 'notification.deliver'),
          eq(schema.jobEffect.idempotencyKey, key),
        ),
      ),
  );
}

afterEach(() => {
  setNotificationJobDeps(null);
});

describe('notification.deliver: definition', () => {
  it('is a registered workspace job keyed by notification and channel, retried with backoff', () => {
    expect(registry.get('notification.deliver')).toBe(notificationDeliver);
    const payload = { workspaceId: randomUUID(), notificationId: randomUUID(), channel: 'email' };
    const parsed = notificationDeliver.schema.parse(payload);
    expect(notificationDeliver.singleton?.key(parsed)).toBe(`${payload.notificationId}:email`);
    expect(notificationDeliver.idempotencyKey?.(parsed)).toBe(`${payload.notificationId}:email`);
    expect(notificationDeliver.retry).toMatchObject({ limit: 5, delaySec: 30, backoff: true });
    expect(notificationDeliver.schema.safeParse({ ...payload, channel: 'in_app' }).success).toBe(
      false,
    );
    expect(
      notificationDeliver.schema.safeParse({ ...payload, workspaceId: undefined }).success,
    ).toBe(false);
  });
});

describe('notification.deliver: email', () => {
  it('sends once per notification and channel, even when the job is redelivered', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      const notificationId = await f.addNotification();
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'email' } as const;
      expect(await deliver(f, payload, deps)).toBe('sent');
      expect(await deliver(f, payload, deps)).toBe('already_delivered');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: f.email, subject: 'Hearing tomorrow' });
      expect(sent[0]?.html).toContain(`${APP_URL}/w/x/m/1`);
      expect((await deliveryOf(f, notificationId))?.email).toMatchObject({ status: 'sent' });
    });
  });

  it('delivers what notify() enqueued without adding in-app rows', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      const jobs: DeliveryJob[] = [];
      await notify(
        {
          db: f.tx,
          workspaceId: f.workspaceId,
          enqueueDelivery: (job) => {
            jobs.push(job);
            return Promise.resolve();
          },
        },
        { userId: f.userId, category: 'reminder.hearing', title: 'Hearing tomorrow', href: '/w/x' },
      );
      const email = jobs.find((j) => j.channel === 'email');
      if (!email) throw new Error('no email job enqueued');
      expect(await deliverJob(f, email, deps)).toEqual({ status: 'completed' });
      expect(await deliverJob(f, email, deps)).toEqual({ status: 'completed' });
      expect(sent).toHaveLength(1);
      expect(await f.rows()).toHaveLength(1);
    });
  });

  it('retries a transient SES failure with the claim released, then sends', async () => {
    await run(async (f) => {
      const { sent, state, deps } = transport();
      const notificationId = await f.addNotification();
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'email' } as const;
      state.failWith = sesError('TooManyRequestsException', 429);
      const outcome = await deliverJob(f, payload, deps);
      expect(outcome).toEqual({
        status: 'failed',
        error: { name: 'RetryableError', code: 'NOTIFICATION_DELIVERY_RETRY' },
      });
      expect(await claims(f, deliveryKey(payload))).toHaveLength(0);
      expect(await deliveryOf(f, notificationId)).toBeUndefined();

      state.failWith = undefined;
      expect(await deliverJob(f, payload, deps)).toEqual({ status: 'completed' });
      expect(sent).toHaveLength(1);
    });
  });

  it('marks a permanent SES failure failed, completes and never re-sends or duplicates rows', async () => {
    await run(async (f) => {
      const { sent, state, deps } = transport();
      const notificationId = await f.addNotification();
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'email' } as const;
      state.failWith = sesError('MessageRejected', 400);
      expect(await deliverJob(f, payload, deps)).toEqual({ status: 'completed' });
      expect((await deliveryOf(f, notificationId))?.email).toMatchObject({
        status: 'failed',
        code: 'MessageRejected',
      });

      state.failWith = undefined;
      expect(await deliver(f, payload, deps)).toBe('already_delivered');
      expect(sent).toHaveLength(0);
      expect(await f.rows()).toHaveLength(1);
    });
  });

  it('skips a suppression-listed address without calling the transport', async () => {
    await run(async (f) => {
      const { sent, state, deps } = transport();
      await recordSuppression(f.tx, { email: f.email.toUpperCase(), reason: 'bounce' });
      const notificationId = await f.addNotification();
      state.failWith = new Error('transport must not be called');
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'email' } as const;
      expect(await deliver(f, payload, deps)).toBe('skipped');
      expect(sent).toHaveLength(0);
      expect((await deliveryOf(f, notificationId))?.email).toMatchObject({
        status: 'skipped',
        reason: 'suppressed',
      });
    });
  });

  it('skips a channel the member turned off, and a recipient who left', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      const notificationId = await f.addNotification({ category: 'member.joined' });
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'email' } as const;
      expect(await deliver(f, payload, deps)).toBe('skipped');
      expect((await deliveryOf(f, notificationId))?.email).toMatchObject({ reason: 'disabled' });

      const other = await f.addNotification();
      await f.inWs((s) =>
        s
          .update(schema.member)
          .set({ status: 'suspended' })
          .where(eq(schema.member.userId, f.userId)),
      );
      const left = { ...payload, notificationId: other };
      expect(await deliver(f, left, deps)).toBe('skipped');
      expect((await deliveryOf(f, other))?.email).toMatchObject({ reason: 'not_member' });
      expect(sent).toHaveLength(0);
    });
  });

  it('completes without sending for an unknown notification', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      const payload = {
        workspaceId: f.workspaceId,
        notificationId: randomUUID(),
        channel: 'email',
      } as const;
      expect(await deliver(f, payload, deps)).toBe('missing');
      expect(sent).toHaveLength(0);
    });
  });

  it('uses the category template: security alerts keep their own subject', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      const notificationId = await f.addNotification({ category: 'security.alert' });
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'email' } as const;
      expect(await deliver(f, payload, deps)).toBe('sent');
      expect(sent[0]?.subject).toBe('Security alert: Hearing tomorrow');
    });
  });
});

const vapid = generateVapidKeys();

/** A push sender over a stubbed `web-push` client answering `status` for every endpoint. */
function pusher(deps: NotificationJobDeps) {
  const pushes: { endpoint: string; payload: string }[] = [];
  const state = { status: 201 };
  const client: WebPushClient = {
    sendNotification: (sub, payload) => {
      pushes.push({ endpoint: sub.endpoint, payload });
      if (state.status >= 400) {
        return Promise.reject(Object.assign(new Error('push'), { statusCode: state.status }));
      }
      return Promise.resolve({});
    },
  };
  const env = {
    APP_URL,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: new Secret(vapid.privateKey),
  };
  return { pushes, state, deps: { ...deps, push: createPushSender({ env, client }) } };
}

async function subscribe(f: Fixture, name: string) {
  await saveSubscription(f.tx, f.userId, {
    endpoint: `https://push.example.test/${name}`,
    keys: { p256dh: `p-${name}`, auth: `a-${name}` },
  });
}

async function setDetails(f: Fixture, on: boolean) {
  await f.inWs((s) =>
    s
      .insert(schema.notificationSetting)
      .values({ workspaceId: f.workspaceId, userId: f.userId, lockScreenDetails: on }),
  );
}

describe('notification.deliver: push', () => {
  it('records push as skipped while no push sender is configured (#197)', async () => {
    await run(async (f) => {
      const { deps } = transport();
      const notificationId = await f.addNotification({ category: 'security.alert' });
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'push' } as const;
      expect(await deliver(f, payload, deps)).toBe('skipped');
      expect((await deliveryOf(f, notificationId))?.push).toMatchObject({
        status: 'skipped',
        reason: 'push_disabled',
      });
    });
  });

  it('pushes a content-free payload once, even when the job is redelivered', async () => {
    await run(async (f) => {
      const { pushes, deps } = pusher(transport().deps);
      await subscribe(f, 'phone');
      const notificationId = await f.addNotification();
      await f.inWs((s) =>
        s
          .update(schema.notification)
          .set({ title: 'Hearing tomorrow: Sharma v. State', body: 'Party: Ravi Sharma' })
          .where(eq(schema.notification.id, notificationId)),
      );
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'push' } as const;
      expect(await deliver(f, payload, deps)).toBe('sent');
      expect(await deliver(f, payload, deps)).toBe('already_delivered');
      expect(pushes).toHaveLength(1);
      expect(JSON.parse(pushes[0]?.payload ?? '{}')).toEqual({
        title: GENERIC_PUSH_TITLES['reminder.hearing'],
        href: `${APP_URL}/w/x/m/1`,
        tag: `n:${notificationId}`,
      });
      expect(pushes[0]?.payload).not.toContain('Sharma');
      expect((await deliveryOf(f, notificationId))?.push).toMatchObject({ status: 'sent' });
    });
  });

  it('includes title and body when the member turned on `Show details on lock screen`', async () => {
    await run(async (f) => {
      const { pushes, deps } = pusher(transport().deps);
      await subscribe(f, 'phone');
      await setDetails(f, true);
      const notificationId = await f.addNotification();
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'push' } as const;
      expect(await deliver(f, payload, deps)).toBe('sent');
      expect(JSON.parse(pushes[0]?.payload ?? '{}')).toMatchObject({ title: 'Hearing tomorrow' });
    });
  });

  it('skips push inside court hours when `Do not push during court hours` is on', async () => {
    await run(async (f) => {
      const { pushes, deps } = pusher(transport().deps);
      await subscribe(f, 'phone');
      await f.inWs((s) =>
        s
          .insert(schema.notificationSetting)
          .values({ workspaceId: f.workspaceId, userId: f.userId, courtHoursQuiet: true }),
      );
      // No workspace_settings row: the workspace is on Asia/Kolkata (UTC+5:30).
      const inCourt = { ...deps, now: () => new Date('2026-10-19T06:30:00Z') }; // 12:00 IST
      const quietId = await f.addNotification();
      const quiet = {
        workspaceId: f.workspaceId,
        notificationId: quietId,
        channel: 'push',
      } as const;
      expect(await deliver(f, quiet, inCourt)).toBe('skipped');
      expect(pushes).toHaveLength(0);
      expect((await deliveryOf(f, quietId))?.push).toMatchObject({
        status: 'skipped',
        reason: 'quiet_hours',
      });
      expect(await f.rows()).toHaveLength(1);

      const evening = { ...deps, now: () => new Date('2026-10-19T12:30:00Z') }; // 18:00 IST
      const laterId = await f.addNotification();
      const later = {
        workspaceId: f.workspaceId,
        notificationId: laterId,
        channel: 'push',
      } as const;
      expect(await deliver(f, later, evening)).toBe('sent');
      expect(pushes).toHaveLength(1);
    });
  });

  it('pushes inside court hours when the member left the setting off', async () => {
    await run(async (f) => {
      const { pushes, deps } = pusher(transport().deps);
      await subscribe(f, 'phone');
      const inCourt = { ...deps, now: () => new Date('2026-10-19T06:30:00Z') };
      const notificationId = await f.addNotification();
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'push' } as const;
      expect(await deliver(f, payload, inCourt)).toBe('sent');
      expect(pushes).toHaveLength(1);
    });
  });

  it('skips a member with no active subscription', async () => {
    await run(async (f) => {
      const { pushes, deps } = pusher(transport().deps);
      const notificationId = await f.addNotification();
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'push' } as const;
      expect(await deliver(f, payload, deps)).toBe('skipped');
      expect(pushes).toEqual([]);
      expect((await deliveryOf(f, notificationId))?.push).toMatchObject({
        status: 'skipped',
        reason: 'no_subscription',
      });
    });
  });

  it('revokes a 410 subscription, and retries a transient push failure', async () => {
    await run(async (f) => {
      const { pushes, state, deps } = pusher(transport().deps);
      await subscribe(f, 'phone');
      const notificationId = await f.addNotification();
      const payload = { workspaceId: f.workspaceId, notificationId, channel: 'push' } as const;

      state.status = 503;
      expect(await deliverJob(f, payload, deps)).toEqual({
        status: 'failed',
        error: { name: 'RetryableError', code: 'NOTIFICATION_DELIVERY_RETRY' },
      });
      expect(await claims(f, deliveryKey(payload))).toHaveLength(0);

      state.status = 410;
      expect(await deliverJob(f, payload, deps)).toEqual({ status: 'completed' });
      expect((await deliveryOf(f, notificationId))?.push).toMatchObject({
        status: 'skipped',
        reason: 'no_subscription',
      });
      const [sub] = await f.tx
        .select({ revokedAt: schema.pushSubscription.revokedAt })
        .from(schema.pushSubscription)
        .where(eq(schema.pushSubscription.userId, f.userId));
      expect(sub?.revokedAt).not.toBeNull();
      expect(pushes).toHaveLength(2);
    });
  });
});
