// The daily digest (#196): scheduled in Asia/Kolkata, due at 18:30 workspace-local time, skipped
// when there is nothing to report, never sent inside the member's quiet hours, and sent once per
// member and day. Testcontainers database, causedeck_app, rolled back per test.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { recordSuppression, type EmailMessage } from '@causedeck/notifications/email';
import { createLogger } from '@causedeck/observability';
import { describe, expect, it } from 'vitest';

import type { JobContext } from '../context.ts';
import { registry } from '../registry.ts';
import type { NotificationJobDeps } from './notification-deliver.ts';
import {
  digestDueAt,
  digestInstant,
  notificationDigest,
  notificationDigestSchedule,
  runNotificationDigest,
  runNotificationDigestSchedule,
  type DigestTarget,
} from './notification-digest.ts';

const APP_URL = 'https://app.causedeck.test';
const DATE = '2026-10-19';
/** 18:30 IST on DATE. */
const AT_1830_IST = new Date('2026-10-19T13:00:00Z');
const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

function transport(now: Date = AT_1830_IST) {
  const sent: EmailMessage[] = [];
  const deps: NotificationJobDeps = {
    appUrl: APP_URL,
    now: () => now,
    email: {
      provider: 'console',
      send: (message) => {
        sent.push(message);
        return Promise.resolve({});
      },
    },
  };
  return { sent, deps };
}

interface Fixture {
  tx: Transaction;
  workspaceId: string;
  userId: string;
  email: string;
  inWs: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
  /** Ask for `category` by email in the daily digest. */
  daily: (category?: string) => Promise<void>;
  addNotification: (createdAt: Date, category?: string) => Promise<void>;
  run: (deps: NotificationJobDeps, digestDate?: string) => ReturnType<typeof runNotificationDigest>;
}

async function setup(tx: Transaction, timezone?: string): Promise<Fixture> {
  const workspaceId = randomUUID();
  const email = `d-${randomUUID()}@example.test`;
  const [u] = await tx
    .insert(schema.user)
    .values({ name: 'Member', email })
    .returning({ id: schema.user.id });
  if (!u) throw new Error('user insert failed');
  const inWs = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, workspaceId, fn);
  await inWs(async (s) => {
    await s
      .insert(schema.organization)
      .values({ id: workspaceId, name: 'Digest', slug: `digest-${workspaceId}` });
    await s
      .insert(schema.member)
      .values({ organizationId: workspaceId, userId: u.id, role: 'owner' });
    if (timezone !== undefined) {
      await s.insert(schema.workspaceSettings).values({ workspaceId, timezone });
    }
  });
  const ctx = (s: Transaction): JobContext => ({
    log: logger,
    db: s,
    workspaceId,
    jobName: 'notification.digest',
    jobId: randomUUID(),
    attempt: 1,
    signal: new AbortController().signal,
    idempotencyKey: `${workspaceId}:${DATE}`,
  });
  return {
    tx,
    workspaceId,
    userId: u.id,
    email,
    inWs,
    daily: (category = 'reminder.hearing') =>
      inWs(async (s) => {
        await s.insert(schema.notificationPref).values({
          workspaceId,
          userId: u.id,
          category,
          channel: 'email',
          enabled: true,
          digest: 'daily',
        });
      }),
    addNotification: (createdAt, category = 'reminder.hearing') =>
      inWs(async (s) => {
        await s.insert(schema.notification).values({
          workspaceId,
          userId: u.id,
          category,
          title: 'Hearing tomorrow: W.P. 1234/2026',
          href: '/w/digest/matters/1',
          createdAt,
        });
      }),
    run: (deps, digestDate = DATE) =>
      inWs((s) => runNotificationDigest(ctx(s), { workspaceId, digestDate }, deps)),
  };
}

const run = (fn: (f: Fixture) => Promise<void>, timezone?: string) =>
  withTestDb(async (tx) => fn(await setup(tx, timezone)));

describe('notification digest: schedule', () => {
  it('registers a half-hourly scheduler and a per-workspace digest job', () => {
    expect(registry.get('system.notification.digest')).toBe(notificationDigestSchedule);
    expect(registry.get('notification.digest')).toBe(notificationDigest);
    // The worker registers every schedule with tz Asia/Kolkata (apps/worker/src/schedules.ts).
    expect(notificationDigestSchedule.schedule?.cron).toBe('0,30 * * * *');
    expect(notificationDigest.singleton?.key({ workspaceId: 'w', digestDate: DATE })).toBe(
      `w:${DATE}`,
    );
    expect(notificationDigest.retry.backoff).toBe(true);
  });

  it('is due at 18:30 in Asia/Kolkata, and at 18:30 local in other zones', () => {
    expect(digestDueAt(new Date('2026-10-19T12:59:00Z'), 'Asia/Kolkata')).toBeNull();
    expect(digestDueAt(AT_1830_IST, 'Asia/Kolkata')).toBe(DATE);
    expect(digestDueAt(new Date('2026-10-19T13:15:00Z'), 'Asia/Kolkata')).toBe(DATE);
    expect(digestDueAt(new Date('2026-10-19T13:30:00Z'), 'Asia/Kolkata')).toBeNull();
    // 18:30 in Dubai (UTC+4) is 14:30Z.
    expect(digestDueAt(new Date('2026-10-19T14:30:00Z'), 'Asia/Dubai')).toBe(DATE);
    expect(digestDueAt(AT_1830_IST, 'Asia/Dubai')).toBeNull();
    // An invalid zone falls back to Asia/Kolkata.
    expect(digestDueAt(AT_1830_IST, 'Not/AZone')).toBe(DATE);
    expect(digestInstant(DATE, 'Asia/Kolkata').toISOString()).toBe('2026-10-19T13:00:00.000Z');
  });

  it('enqueues ids and the local date only for workspaces in their 18:30 slot', async () => {
    await withTestDb(async (tx) => {
      const ist = await setup(tx);
      const dubai = await setup(tx, 'Asia/Dubai');
      const targets: DigestTarget[] = [];
      await runNotificationDigestSchedule(
        { db: tx, log: logger },
        {
          now: () => AT_1830_IST,
          enqueue: (t) => {
            targets.push(t);
            return Promise.resolve();
          },
        },
      );
      expect(targets).toContainEqual({ workspaceId: ist.workspaceId, digestDate: DATE });
      expect(targets.map((t) => t.workspaceId)).not.toContain(dubai.workspaceId);
    });
  });
});

describe('notification digest: sending', () => {
  it('sends one digest of the day’s daily-mode notifications, once', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      await f.daily();
      await f.addNotification(new Date('2026-10-19T05:00:00Z'));
      // Before the previous 18:30 IST: belongs to yesterday's digest.
      await f.addNotification(new Date('2026-10-18T12:00:00Z'));
      expect(await f.run(deps)).toMatchObject({ sent: 1 });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: f.email, subject: 'Your CauseDeck daily digest' });
      expect(sent[0]?.text).toContain('1 update');
      expect(sent[0]?.html).toContain(`${APP_URL}/w/digest/matters/1`);
      expect(await f.run(deps)).toMatchObject({ sent: 0, alreadySent: 1 });
      expect(sent).toHaveLength(1);
    });
  });

  it('is skipped when there is nothing to report', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      await f.daily();
      expect(await f.run(deps)).toMatchObject({ sent: 0, skippedEmpty: 1 });
      // Instant-mode notifications were already delivered; they are not digest content.
      await f.addNotification(new Date('2026-10-19T05:00:00Z'), 'billing.notice');
      expect(await f.run(deps)).toMatchObject({ sent: 0, skippedEmpty: 1 });
      expect(sent).toHaveLength(0);
    });
  });

  it('is never sent during the member’s configured quiet hours', async () => {
    await run(async (f) => {
      await f.daily();
      await f.addNotification(new Date('2026-10-19T04:00:00Z'));
      await f.inWs(async (s) => {
        await s
          .insert(schema.notificationSetting)
          .values({ workspaceId: f.workspaceId, userId: f.userId, courtHoursQuiet: true });
      });
      // A late run at 11:00 IST (05:30Z) is inside court hours: no send.
      const quiet = transport(new Date('2026-10-19T05:30:00Z'));
      expect(await f.run(quiet.deps)).toMatchObject({ sent: 0, skippedQuiet: 1 });
      expect(quiet.sent).toHaveLength(0);
      // At 18:30 IST the same member gets it.
      const evening = transport();
      expect(await f.run(evening.deps)).toMatchObject({ sent: 1 });
    });
  });

  it('skips a suppressed address and a member who turned the digest email off', async () => {
    await run(async (f) => {
      const { sent, deps } = transport();
      await f.daily();
      await f.addNotification(new Date('2026-10-19T05:00:00Z'));
      await recordSuppression(f.tx, { email: f.email, reason: 'complaint' });
      expect(await f.run(deps)).toMatchObject({ sent: 0, skippedSuppressed: 1 });

      await f.inWs(async (s) => {
        await s.insert(schema.notificationPref).values({
          workspaceId: f.workspaceId,
          userId: f.userId,
          category: 'digest.daily',
          channel: 'email',
          enabled: false,
        });
      });
      expect(await f.run(deps)).toMatchObject({ sent: 0, skippedDisabled: 1 });
      expect(sent).toHaveLength(0);
    });
  });
});
