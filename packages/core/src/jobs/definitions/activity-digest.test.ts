// The end-of-day digest (#49): scheduled every half hour from 18:00 to 23:30 in Asia/Kolkata, fanned
// out per workspace to the members whose own time is the slot, built from counts only, sent once per
// `(userId, localDate)` with the in-app notification and the email, never for an empty day, never with
// document content or a name unless the member opted in, and kept apart per workspace. Testcontainers
// database, causedeck_app, rolled back per test.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import { setEndOfDayPreference } from '@causedeck/notifications';
import { recordSuppression, type EmailMessage } from '@causedeck/notifications/email';
import { createLogger } from '@causedeck/observability';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createMatter, setSensitive } from '../../index.ts';
import type { JobContext } from '../context.ts';
import { RetryableError } from '../errors.ts';
import { registry } from '../registry.ts';
import {
  activityDigest,
  activityDigestMember,
  activityDigestSchedule,
  runActivityDigest,
  runActivityDigestMember,
  runActivityDigestSchedule,
  type ActivityDigestMemberPayload,
  type ActivityDigestTarget,
} from './activity-digest.ts';
import type { NotificationJobDeps } from './notification-deliver.ts';
import { runNotificationDeliver } from './notification-deliver.ts';

const APP_URL = 'https://app.causedeck.test';
const DATE = '2026-10-19';
/** 20:30 IST on DATE. */
const AT_2030_IST = new Date('2026-10-19T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

function transport(fail?: Error) {
  const sent: EmailMessage[] = [];
  const deps: NotificationJobDeps = {
    appUrl: APP_URL,
    now: () => AT_2030_IST,
    email: {
      provider: 'console',
      send: (message) => {
        if (fail !== undefined) return Promise.reject(fail);
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
  slug: string;
  userId: string;
  email: string;
  inWs: <T>(fn: (s: Transaction) => Promise<T>) => Promise<T>;
  ctx: (s: Transaction, name?: string) => JobContext;
  activity: (
    summary: string,
    extra?: Partial<typeof schema.activity.$inferInsert>,
  ) => Promise<void>;
  member: (
    deps: NotificationJobDeps,
    localDate?: string,
  ) => ReturnType<typeof runActivityDigestMember>;
  notifications: () => Promise<{ title: string; body: string | null; href: string | null }[]>;
}

async function workspaceFor(tx: Transaction, userId: string, email: string): Promise<Fixture> {
  const workspaceId = randomUUID();
  const slug = `eod-${workspaceId.slice(0, 8)}`;
  const inWs = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, workspaceId, fn);
  await inWs(async (s) => {
    await s.insert(schema.organization).values({ id: workspaceId, name: 'Digest', slug });
    await s.insert(schema.member).values({ organizationId: workspaceId, userId, role: 'owner' });
  });
  const ctx = (s: Transaction, name = 'activity.digest.member'): JobContext => ({
    log: logger,
    db: s,
    workspaceId,
    jobName: name,
    jobId: randomUUID(),
    attempt: 1,
    signal: new AbortController().signal,
    idempotencyKey: `eod:${userId}:${DATE}`,
  });
  return {
    tx,
    workspaceId,
    slug,
    userId,
    email,
    inWs,
    ctx,
    activity: (summary, extra = {}) =>
      inWs(async (s) => {
        const createdAt = new Date('2026-10-19T08:00:00Z');
        await s.insert(schema.activity).values({
          workspaceId,
          kind: 'task',
          level: 'L3',
          actor: 'system',
          summary,
          createdAt,
          undoExpiresAt: new Date(createdAt.getTime() + 7 * DAY),
          ...extra,
        });
      }),
    member: (deps, localDate = DATE) =>
      inWs((s) =>
        runActivityDigestMember(
          ctx(s),
          { workspaceId, userId, localDate } satisfies ActivityDigestMemberPayload,
          deps,
        ),
      ),
    notifications: () =>
      inWs((s) =>
        s
          .select({
            title: schema.notification.title,
            body: schema.notification.body,
            href: schema.notification.href,
          })
          .from(schema.notification)
          .where(eq(schema.notification.workspaceId, workspaceId)),
      ),
  };
}

async function setup(tx: Transaction): Promise<Fixture> {
  const email = `e-${randomUUID()}@example.test`;
  const [u] = await tx
    .insert(schema.user)
    .values({ name: 'Member', email })
    .returning({ id: schema.user.id });
  if (!u) throw new Error('user insert failed');
  return workspaceFor(tx, u.id, email);
}

const run = (fn: (f: Fixture) => Promise<void>) => withTestDb(async (tx) => fn(await setup(tx)));

describe('end-of-day digest: schedule', () => {
  it('registers a scheduler, a per-workspace fan-out and a per-member job', () => {
    expect(registry.get('system.activity.digest')).toBe(activityDigestSchedule);
    expect(registry.get('activity.digest')).toBe(activityDigest);
    expect(registry.get('activity.digest.member')).toBe(activityDigestMember);
    // The worker registers every schedule with tz Asia/Kolkata (apps/worker/src/schedules.ts).
    expect(activityDigestSchedule.schedule?.cron).toBe('0,30 18-23 * * *');
    expect(
      activityDigestMember.singleton?.key({ workspaceId: 'w', userId: 'u', localDate: DATE }),
    ).toBe(`eod:u:${DATE}`);
    expect(activityDigestMember.retry).toMatchObject({ limit: 3, backoff: true });
  });

  it('enqueues a workspace only inside an evening slot, with ids, the local date and the slot', () =>
    run(async (f) => {
      const targets: ActivityDigestTarget[] = [];
      const enqueue = (t: ActivityDigestTarget) => {
        targets.push(t);
        return Promise.resolve();
      };
      await runActivityDigestSchedule(
        { db: f.tx, log: logger },
        { now: () => AT_2030_IST, enqueue },
      );
      const mine = targets.filter((t) => t.workspaceId === f.workspaceId);
      expect(mine).toEqual([{ workspaceId: f.workspaceId, localDate: DATE, slot: '20:30' }]);

      targets.length = 0;
      // 08:30 IST: no slot, nothing is enqueued.
      await runActivityDigestSchedule(
        { db: f.tx, log: logger },
        { now: () => new Date('2026-10-19T03:00:00Z'), enqueue },
      );
      expect(targets).toEqual([]);
    }));
});

describe('end-of-day digest: fan-out', () => {
  it('enqueues the members whose time is the slot and who have the digest on', () =>
    run(async (f) => {
      const queued: ActivityDigestMemberPayload[] = [];
      const enqueue = (p: ActivityDigestMemberPayload) => {
        queued.push(p);
        return Promise.resolve();
      };
      const fan = (slot: string) =>
        f.inWs((s) =>
          runActivityDigest(
            f.ctx(s, 'activity.digest'),
            { workspaceId: f.workspaceId, localDate: DATE, slot },
            { enqueue },
          ),
        );
      expect(await fan('20:30')).toEqual({ due: 1, skippedDisabled: 0 });
      expect(queued).toEqual([{ workspaceId: f.workspaceId, userId: f.userId, localDate: DATE }]);

      queued.length = 0;
      expect(await fan('19:00')).toEqual({ due: 0, skippedDisabled: 0 });

      await f.inWs((s) =>
        setEndOfDayPreference(
          { db: s, workspaceId: f.workspaceId },
          { userId: f.userId, time: '19:00' },
        ),
      );
      expect((await fan('19:00')).due).toBe(1);

      await f.inWs((s) =>
        setEndOfDayPreference(
          { db: s, workspaceId: f.workspaceId },
          { userId: f.userId, enabled: false },
        ),
      );
      expect(await fan('19:00')).toEqual({ due: 0, skippedDisabled: 1 });
    }));
});

describe('end-of-day digest: one member', () => {
  it('sends the in-app notification and the email once, counts only, and never content', () =>
    run(async (f) => {
      const { sent, deps } = transport();
      await f.activity('SECRET-SUMMARY attached the order to a matter');
      await f.activity('another change');
      expect(await f.member(deps)).toBe('sent');
      expect(sent).toHaveLength(1);
      const [message] = sent;
      expect(message?.to).toBe(f.email);
      expect(message?.subject).toBe('What CauseDeck did today');
      const everything = (message?.html ?? '') + (message?.text ?? '');
      expect(everything).toContain(`${APP_URL}/w/${f.slug}/activity?day=${DATE}`);
      expect(everything).toContain(`${APP_URL}/w/${f.slug}/inbox`);
      expect(everything).not.toContain('SECRET-SUMMARY');
      expect(everything).not.toContain('Digest');

      const rows = await f.notifications();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: 'What CauseDeck did today',
        href: `/w/${f.slug}/activity?day=${DATE}`,
      });
      expect((rows[0]?.title ?? '') + (rows[0]?.body ?? '')).not.toContain('SECRET-SUMMARY');

      // Idempotent per (userId, localDate): a redelivered job sends nothing more.
      expect(await f.member(deps)).toBe('alreadySent');
      expect(sent).toHaveLength(1);
      expect(await f.notifications()).toHaveLength(1);
    }));

  it('sends nothing for a day with no activity and nothing pending', () =>
    run(async (f) => {
      const { sent, deps } = transport();
      expect(await f.member(deps)).toBe('skippedEmpty');
      // Yesterday's activity is not today's.
      await f.activity('yesterday', { createdAt: new Date('2026-10-18T08:00:00Z') });
      expect(await f.member(deps)).toBe('skippedEmpty');
      expect(sent).toEqual([]);
      expect(await f.notifications()).toEqual([]);
    }));

  it('sends nothing when the member turned the digest off or the address is suppressed', () =>
    run(async (f) => {
      const { sent, deps } = transport();
      await f.activity('a change');
      await f.inWs((s) =>
        setEndOfDayPreference(
          { db: s, workspaceId: f.workspaceId },
          { userId: f.userId, enabled: false },
        ),
      );
      expect(await f.member(deps)).toBe('skippedDisabled');
      await f.inWs((s) =>
        setEndOfDayPreference(
          { db: s, workspaceId: f.workspaceId },
          { userId: f.userId, enabled: true },
        ),
      );
      await recordSuppression(f.tx, { email: f.email, reason: 'bounce' });
      expect(await f.member(deps)).toBe('skippedSuppressed');
      expect(sent).toEqual([]);
    }));

  it('leaves a sensitive matter out and names matters only when the member opted in', () =>
    run(async (f) => {
      const { sent, deps } = transport();
      const actor = { userId: f.userId, workspaceId: f.workspaceId };
      const graph = { db: f.tx, events: { emit() {} } };
      const open = await createMatter(graph, actor, { title: 'Ilango v. State (fictional)' });
      const secret = await createMatter(graph, actor, { title: 'Secret v. Hidden (fictional)' });
      await setSensitive(graph, actor, { matterId: secret.id, sensitive: true });
      await f.activity('open matter', { entityRefs: { matterId: open.id } });
      await f.activity('sensitive matter', { entityRefs: { matterId: secret.id } });
      expect(await f.member(deps)).toBe('sent');
      expect(sent[0]?.html ?? '').not.toContain('Ilango');
      expect((sent[0]?.html ?? '') + (sent[0]?.text ?? '')).not.toContain('Secret v. Hidden');

      await f.inWs((s) =>
        setEndOfDayPreference(
          { db: s, workspaceId: f.workspaceId },
          { userId: f.userId, includeNames: true },
        ),
      );
      expect(await f.member(deps, '2026-10-19')).toBe('alreadySent');
      // A later day with names on: the open matter is named, the sensitive one never.
      await f.activity('next day', {
        entityRefs: { matterId: open.id },
        createdAt: new Date('2026-10-20T08:00:00Z'),
        undoExpiresAt: new Date('2026-10-27T08:00:00Z'),
      });
      await f.activity('next day sensitive', {
        entityRefs: { matterId: secret.id },
        createdAt: new Date('2026-10-20T08:30:00Z'),
        undoExpiresAt: new Date('2026-10-27T08:30:00Z'),
      });
      expect(await f.member(deps, '2026-10-20')).toBe('sent');
      const second = sent[1];
      expect(second?.html).toContain('Ilango v. State (fictional)');
      expect((second?.html ?? '') + (second?.text ?? '')).not.toContain('Secret v. Hidden');
    }));

  it('retries a transient email failure and rolls the claim back', () =>
    run(async (f) => {
      const { deps } = transport(new Error('connection reset'));
      await f.activity('a change');
      await expect(f.member(deps)).rejects.toBeInstanceOf(RetryableError);
    }));

  it('sends separate digests for each workspace of a user in two workspaces', () =>
    withTestDb(async (tx) => {
      const a = await setup(tx);
      const b = await workspaceFor(tx, a.userId, a.email);
      const { sent, deps } = transport();
      await a.activity('change in A');
      await b.activity('change in B');
      await b.activity('second change in B');
      expect(await a.member(deps)).toBe('sent');
      expect(await b.member(deps)).toBe('sent');
      expect(sent).toHaveLength(2);
      expect(sent[0]?.html).toContain(`/w/${a.slug}/activity?day=${DATE}`);
      expect(sent[0]?.html).not.toContain(b.slug);
      expect(sent[1]?.html).toContain(`/w/${b.slug}/activity?day=${DATE}`);
      expect(sent[1]?.html).not.toContain(a.slug);
    }));

  it('is not sent for a user who is not a member of the workspace', () =>
    withTestDb(async (tx) => {
      const a = await setup(tx);
      const b = await setup(tx);
      const { sent, deps } = transport();
      await a.activity('change in A');
      const outsider = await b.inWs((s) =>
        runActivityDigestMember(
          b.ctx(s),
          { workspaceId: b.workspaceId, userId: a.userId, localDate: DATE },
          deps,
        ),
      );
      expect(outsider).toBe('skippedNotMember');
      expect(sent).toEqual([]);
    }));
});

describe('end-of-day digest: the generic delivery job', () => {
  it('does not send a second, generic email for the digest category', () =>
    run(async (f) => {
      const { sent, deps } = transport();
      const [row] = await f.inWs((s) =>
        s
          .insert(schema.notification)
          .values({
            workspaceId: f.workspaceId,
            userId: f.userId,
            category: 'digest.end_of_day',
            title: 'What CauseDeck did today',
            href: `/w/${f.slug}/activity`,
          })
          .returning({ id: schema.notification.id }),
      );
      const outcome = await f.inWs((s) =>
        runNotificationDeliver(
          f.ctx(s, 'notification.deliver'),
          { workspaceId: f.workspaceId, notificationId: row?.id ?? '', channel: 'email' },
          deps,
        ),
      );
      expect(outcome).toBe('skipped');
      expect(sent).toEqual([]);
    }));
});
