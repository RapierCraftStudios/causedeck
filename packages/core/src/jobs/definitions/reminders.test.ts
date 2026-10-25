// Court-day reminders (#64, ADR 0039): the scheduler enqueues per-member jobs at the member's own
// IST slot (fake clock), the evening brief goes only when something is listed tomorrow, the morning
// diff only when the day's list changed, each channel sends once through `reminder_dispatch` (a
// retry sends nothing twice), opt-outs are respected per kind and channel, a push carries no party
// name, and a failed send is released and retried. Testcontainers database, rolled back per test.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Writable } from 'node:stream';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import {
  buildCourtHall,
  buildForum,
  buildListing,
  buildMatter,
  buildProceeding,
} from '@causedeck/db/testing/matter-graph-fixtures';
import { setReminderPreferences, type PushSender } from '@causedeck/notifications';
import type { EmailMessage } from '@causedeck/notifications/email';
import { createLogger } from '@causedeck/observability';
import type { SnapshotRow } from '@causedeck/validators';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { newWorkspace } from '../../__tests__/fixtures.ts';
import { snapshotList } from '../../court-day/index.ts';
import type { JobContext } from '../context.ts';
import { RetryableError } from '../errors.ts';
import { registry } from '../registry.ts';

import type { NotificationJobDeps } from './notification-deliver.ts';
import {
  dueReminders,
  localDateOf,
  reminderEvening,
  reminderMorning,
  reminderOutcomeMissing,
  reminderSchedule,
  runReminder,
  runReminderSchedule,
  type ReminderKind,
  type ReminderTarget,
} from './reminders.ts';

const APP_URL = 'https://app.causedeck.test';
const TODAY = '2026-10-26';
const TOMORROW = '2026-10-27';
/** 20:00 IST on 2026-10-26 (14:30 UTC). */
const AT_2000_IST = new Date('2026-10-26T14:30:00Z');
const AT_0700_IST = new Date('2026-10-26T01:30:00Z');
const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

function transports(now: Date, failEmail?: Error) {
  const emails: EmailMessage[] = [];
  const pushes: { title: string; body: string | null; href: string | null }[] = [];
  const push: PushSender = {
    send: (message) => {
      pushes.push(message);
      return Promise.resolve({ sent: 1, expired: 0, failed: 0 } as never);
    },
  };
  const deps: NotificationJobDeps = {
    appUrl: APP_URL,
    now: () => now,
    push,
    email: {
      provider: 'console',
      send: (message) => {
        if (failEmail !== undefined) return Promise.reject(failEmail);
        emails.push(message);
        return Promise.resolve({});
      },
    },
  };
  return { emails, pushes, deps };
}

async function setup(tx: Transaction) {
  const { ownerId, workspaceId } = await newWorkspace(tx);
  const inWs = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, workspaceId, fn);
  const [m] = await inWs((s) =>
    s
      .select({ id: schema.member.id, userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.userId, ownerId)),
  );
  const [org] = await inWs((s) =>
    s.select({ slug: schema.organization.slug }).from(schema.organization),
  );
  if (m === undefined || org === undefined) throw new Error('fixture missing');
  const forum = await inWs((s) => buildForum(s, workspaceId));
  const ctx = (s: Transaction, name = 'reminder.evening'): JobContext => ({
    log: logger,
    db: s,
    workspaceId,
    jobName: name,
    jobId: randomUUID(),
    attempt: 1,
    signal: new AbortController().signal,
    idempotencyKey: 'k',
  });
  const send = (kind: ReminderKind, deps: NotificationJobDeps, date = TODAY) =>
    inWs((s) =>
      runReminder(s === tx ? ctx(s) : ctx(s), kind, { workspaceId, memberId: m.id, date }, deps),
    );
  const listTomorrow = (title: string) =>
    inWs(async (s) => {
      const hall = await buildCourtHall(s, workspaceId, { forumId: forum.id, hallNo: '3' });
      const matter = await buildMatter(s, workspaceId, { ownerMemberId: m.id, title });
      const proceeding = await buildProceeding(s, workspaceId, {
        matterId: matter.id,
        forumId: forum.id,
        number: '501',
        year: 2026,
      });
      await buildListing(s, workspaceId, {
        proceedingId: proceeding.id,
        listDate: TOMORROW,
        hallId: hall.id,
        itemNo: '4',
      });
    });
  const snapshot = (rows: SnapshotRow[], listType: 'daily' | 'supplementary') =>
    snapshotList(
      { db: tx, events: { emit: () => undefined } },
      { userId: ownerId, workspaceId },
      { forumId: forum.id, listDate: TODAY, listType, rows },
    );
  const dispatches = () =>
    inWs((s) =>
      s
        .select({ kind: schema.reminderDispatch.kind, channel: schema.reminderDispatch.channel })
        .from(schema.reminderDispatch),
    );
  return {
    tx,
    ownerId,
    workspaceId,
    memberId: m.id,
    slug: org.slug,
    inWs,
    send,
    ctx,
    listTomorrow,
    snapshot,
    dispatches,
  };
}

const run = (fn: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) =>
  withTestDb(async (tx) => fn(await setup(tx)));

const row = (key: string, itemNo: string): SnapshotRow => ({
  proceedingKey: key,
  hallNo: '3',
  itemNo,
  stage: 'FOR ORDERS',
});
const ALL_ON = { in_app: true, push: true, email: true };

describe('reminders: registration and schedule', () => {
  it('registers the scheduler and three member jobs, evening slot inside 18:00-23:00', () => {
    expect(registry.get('system.reminder.schedule')).toBe(reminderSchedule);
    expect(registry.get('reminder.evening')).toBe(reminderEvening);
    expect(registry.get('reminder.morning')).toBe(reminderMorning);
    expect(registry.get('reminder.outcome_missing')).toBe(reminderOutcomeMissing);
    expect(reminderSchedule.schedule?.cron).toBe('0,30 7-23 * * *');
    expect(reminderEvening.retry).toMatchObject({ limit: 3, backoff: true });
    const payload = { workspaceId: 'w', memberId: 'm', date: TOMORROW };
    expect(reminderEvening.singleton?.key(payload as never)).toBe(`reminder:evening:m:${TOMORROW}`);
  });

  it('reads the local date and slot across IST with a fake clock', () => {
    // 19:00 UTC on the 25th is already 00:30 IST on the 26th.
    expect(localDateOf(new Date('2026-10-25T19:00:00Z'), 'Asia/Kolkata')).toBe(TODAY);
    expect(localDateOf(new Date('2026-10-25T18:29:00Z'), 'Asia/Kolkata')).toBe('2026-10-25');
  });

  it('is due by the member’s own times: evening at 20:00, morning at 07:00', () => {
    const prefs = {
      evening: { enabled: true, time: '20:00', channels: ALL_ON },
      morning: { enabled: true, time: '07:00', channels: ALL_ON },
      outcome_missing: { enabled: false, delayMinutes: 90, channels: ALL_ON },
    };
    expect(dueReminders(prefs, 20 * 60 + 10)).toEqual(['evening']);
    expect(dueReminders(prefs, 7 * 60)).toEqual(['morning']);
    expect(dueReminders(prefs, 8 * 60)).toEqual([]);
    expect(dueReminders({ ...prefs, evening: { ...prefs.evening, enabled: false } }, 20 * 60)).toEqual(
      [],
    );
  });

  it('enqueues the evening job for tomorrow at 20:00 IST and the morning job for today at 07:00', () =>
    run(async (f) => {
      const targets: ReminderTarget[] = [];
      const enqueue = (t: ReminderTarget) => {
        targets.push(t);
        return Promise.resolve();
      };
      await runReminderSchedule({ db: f.tx, log: logger }, { now: () => AT_2000_IST, enqueue });
      expect(
        targets.filter((t) => t.payload.workspaceId === f.workspaceId && t.kind === 'evening'),
      ).toEqual([
        {
          kind: 'evening',
          payload: { workspaceId: f.workspaceId, memberId: f.memberId, date: TOMORROW },
        },
      ]);
      targets.length = 0;
      await runReminderSchedule({ db: f.tx, log: logger }, { now: () => AT_0700_IST, enqueue });
      expect(
        targets.filter((t) => t.payload.workspaceId === f.workspaceId).map((t) => [t.kind, t.payload.date]),
      ).toEqual([['morning', TODAY]]);
    }));
});

describe('reminders: evening brief', () => {
  it('sends nothing when nothing is listed tomorrow', () =>
    run(async (f) => {
      const { emails, pushes, deps } = transports(AT_2000_IST);
      expect(await f.send('evening', deps, TOMORROW)).toBe('skippedEmpty');
      expect(emails).toHaveLength(0);
      expect(pushes).toHaveLength(0);
      expect(await f.dispatches()).toEqual([]);
    }));

  it('sends in-app, push and email once, counts only in the push, names only in-app', () =>
    run(async (f) => {
      await f.listTomorrow('Rao v State of Kerala');
      const { emails, pushes, deps } = transports(AT_2000_IST);
      expect(await f.send('evening', deps, TOMORROW)).toBe('sent');
      expect(emails).toHaveLength(1);
      expect(emails[0]?.to).not.toContain('client');
      expect((emails[0]?.html ?? '') + (emails[0]?.text ?? '')).toContain(
        `${APP_URL}/w/${f.slug}/tomorrow`,
      );
      expect(pushes).toHaveLength(1);
      expect(JSON.stringify(pushes)).not.toContain('Rao');
      expect(pushes[0]?.href).toBe(`${APP_URL}/w/${f.slug}/tomorrow`);
      const notes = await f.inWs((s) =>
        s.select({ body: schema.notification.body }).from(schema.notification),
      );
      expect(notes.map((n) => n.body).join(' ')).toContain('Rao v State of Kerala');
      expect((await f.dispatches()).map((d) => d.channel).sort()).toEqual(['email', 'in_app', 'push']);
    }));

  it('is idempotent: a retried job sends nothing twice', () =>
    run(async (f) => {
      await f.listTomorrow('Rao v State');
      const { emails, pushes, deps } = transports(AT_2000_IST);
      expect(await f.send('evening', deps, TOMORROW)).toBe('sent');
      expect(await f.send('evening', deps, TOMORROW)).toBe('alreadySent');
      expect(emails).toHaveLength(1);
      expect(pushes).toHaveLength(1);
      expect(await f.dispatches()).toHaveLength(3);
    }));

  it('releases a failed channel and retries only that one', () =>
    run(async (f) => {
      await f.listTomorrow('Rao v State');
      const bad = transports(AT_2000_IST, new Error('smtp down'));
      await expect(f.send('evening', bad.deps, TOMORROW)).rejects.toBeInstanceOf(RetryableError);
      expect((await f.dispatches()).map((d) => d.channel)).toEqual(['in_app', 'push']);
      const good = transports(AT_2000_IST);
      expect(await f.send('evening', good.deps, TOMORROW)).toBe('sent');
      expect(good.emails).toHaveLength(1);
      expect(good.pushes).toHaveLength(0);
    }));
});

describe('reminders: opt-outs', () => {
  it('respects a disabled channel and a disabled kind', () =>
    run(async (f) => {
      await f.listTomorrow('Rao v State');
      await f.inWs((s) =>
        setReminderPreferences(
          { db: s, workspaceId: f.workspaceId },
          { userId: f.ownerId, evening: { channels: { in_app: true, push: false, email: false } } },
        ),
      );
      const first = transports(AT_2000_IST);
      expect(await f.send('evening', first.deps, TOMORROW)).toBe('sent');
      expect(first.emails).toHaveLength(0);
      expect(first.pushes).toHaveLength(0);
      expect(await f.dispatches()).toEqual([{ kind: 'evening', channel: 'in_app' }]);

      await f.inWs((s) =>
        setReminderPreferences(
          { db: s, workspaceId: f.workspaceId },
          { userId: f.ownerId, morning: { channels: { in_app: false, push: false, email: false } } },
        ),
      );
      const second = transports(AT_0700_IST);
      expect(await f.send('morning', second.deps)).toBe('skippedDisabled');
      expect(second.emails).toHaveLength(0);
    }));
});

describe('reminders: morning diff and outcome missing', () => {
  it('sends the morning diff only when the day’s list changed, with the diff link', () =>
    run(async (f) => {
      const { emails, deps } = transports(AT_0700_IST);
      await f.snapshot([row('WP/1/2026', '1')], 'daily');
      expect(await f.send('morning', deps)).toBe('skippedEmpty');
      await f.snapshot([row('WP/1/2026', '1'), row('WP/2/2026', '2')], 'supplementary');
      expect(await f.send('morning', deps)).toBe('sent');
      expect((emails[0]?.html ?? '') + (emails[0]?.text ?? '')).toContain(
        `${APP_URL}/w/${f.slug}/today?diff=1`,
      );
    }));

  it('sends no outcome reminder when nothing was heard today', () =>
    run(async (f) => {
      const { deps } = transports(new Date('2026-10-26T12:00:00Z'));
      expect(await f.send('outcome_missing', deps)).toBe('skippedEmpty');
    }));
});

describe('reminders: recipients are workspace members only (static)', () => {
  it('has no path that addresses a client or an external email', () => {
    const source = readFileSync(new URL('./reminders.ts', import.meta.url), 'utf8');
    // Recipients come from member -> user only.
    expect(source).toMatch(/\.from\(member\)\s*\.innerJoin\(user,/);
    expect(source).not.toMatch(/\bclient\w*\b.*\bto:/);
    expect(source).not.toMatch(/schema\.(?:client|party|contact|person)\b/);
    for (const name of ['client', 'party', 'contact', 'person'] as const) {
      expect(source).not.toMatch(new RegExp(`\\b${name}\\s*[,}]`));
    }
    // `to:` appears exactly once, and it is the member's own email.
    expect(source.match(/\bto:/g)).toHaveLength(1);
    expect(source).toContain('to: who.email');
    expect(readdirSync(new URL('.', import.meta.url)).includes('reminders.ts')).toBe(true);
  });
});
