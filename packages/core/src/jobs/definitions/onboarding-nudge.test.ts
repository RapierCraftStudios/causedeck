// Onboarding nudges (#601): the next unfinished step only, once per step, at most one per few days,
// dark behind the flag, WhatsApp only to a linked and consenting member and never in court hours,
// and the mock sender when the provider env is absent. Testcontainers database, rolled back per test.
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';

import { schema, type Transaction } from '@causedeck/db';
import { inWorkspace, withTestDb } from '@causedeck/db/testing';
import type { WhatsAppMessage, WhatsAppSender } from '@causedeck/notifications/whatsapp';
import { createLogger } from '@causedeck/observability';
import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import type { JobContext } from '../context.ts';
import { registry } from '../registry.ts';
import { setNotificationJobDeps } from './notification-deliver.ts';
import {
  nextUnfinishedStep,
  onboardingNudge,
  runOnboardingNudge,
  type OnboardingNudgeDeps,
} from './onboarding-nudge.ts';

const DAY = 24 * 60 * 60 * 1000;
/** 09:30 IST, outside court hours. */
const MORNING = new Date('2026-10-19T04:00:00Z');
/** 11:30 IST, inside court hours. */
const COURT_HOURS = new Date('2026-10-19T06:00:00Z');
const logger = createLogger({
  service: 'test',
  level: 'silent',
  destination: new Writable({
    write: (_c, _e, cb) => {
      cb();
    },
  }),
});

afterEach(() => {
  setNotificationJobDeps(null);
});

function spy() {
  const sent: { message: WhatsAppMessage; to: string }[] = [];
  const whatsapp: WhatsAppSender = {
    send(message, target) {
      sent.push({ message, to: target.e164 });
      return Promise.resolve({ messageId: null });
    },
  };
  return { sent, whatsapp };
}

interface Fixture {
  tx: Transaction;
  workspaceId: string;
  slug: string;
  userId: string;
  ctx: JobContext;
  steps: (...steps: schema.ActivationStep[]) => Promise<void>;
  link: (categories: string[]) => Promise<void>;
  titles: () => Promise<string[]>;
  run: (deps?: OnboardingNudgeDeps, now?: Date) => ReturnType<typeof runOnboardingNudge>;
}

async function setup(tx: Transaction): Promise<Fixture> {
  const [u] = await tx
    .insert(schema.user)
    .values({ name: 'Member', email: `n-${randomUUID()}@example.test` })
    .returning({ id: schema.user.id });
  if (!u) throw new Error('user insert failed');
  const userId = u.id;
  const workspaceId = randomUUID();
  const slug = `nudge-${workspaceId.slice(0, 8)}`;
  const inWs = <T>(fn: (s: Transaction) => Promise<T>) => inWorkspace(tx, workspaceId, fn);
  await inWs(async (s) => {
    await s.insert(schema.organization).values({ id: workspaceId, name: 'Nudge', slug });
    await s.insert(schema.member).values({ organizationId: workspaceId, userId, role: 'owner' });
  });
  const ctx: JobContext = {
    log: logger,
    db: tx,
    workspaceId: null,
    jobName: 'system.onboarding.nudge',
    jobId: randomUUID(),
    attempt: 1,
    signal: new AbortController().signal,
    idempotencyKey: 'onboarding-nudge',
  };
  const fixture: Fixture = {
    tx,
    workspaceId,
    slug,
    userId,
    ctx,
    steps: async (...steps) => {
      await tx.insert(schema.activationEvent).values(
        steps.map((step) => ({
          userId,
          step,
          occurredAt: step === 'signed_up' ? new Date(MORNING.getTime() - 5 * DAY) : MORNING,
        })),
      );
    },
    link: (categories) =>
      inWs(async (s) => {
        await s.insert(schema.whatsappLink).values({
          workspaceId,
          userId,
          e164: '+919800000004',
          verifiedAt: new Date(),
          consentAt: new Date(),
          categories,
        });
      }),
    titles: () =>
      inWs((s) =>
        s
          .select({ title: schema.notification.title })
          .from(schema.notification)
          .where(
            and(
              eq(schema.notification.workspaceId, workspaceId),
              eq(schema.notification.category, 'onboarding.nudge'),
            ),
          )
          .then((rows) => rows.map((r) => r.title)),
      ),
    run: (deps = {}, now = MORNING) =>
      runOnboardingNudge(ctx, {
        appUrl: 'https://app.causedeck.test',
        flagEnabled: () => Promise.resolve(true),
        ...deps,
        now: () => now,
      }),
  };
  return fixture;
}

const run = (fn: (f: Fixture) => Promise<void>) => withTestDb(async (tx) => fn(await setup(tx)));

describe('onboarding nudge: schedule', () => {
  it('registers one system job at 09:30 IST', () => {
    expect(registry.get('system.onboarding.nudge')).toBe(onboardingNudge);
    expect(onboardingNudge.schedule?.cron).toBe('30 9 * * *');
  });

  it('picks the first unfinished step in funnel order', () => {
    expect(nextUnfinishedStep(new Set())?.[0]).toBe('identifiers_entered');
    expect(nextUnfinishedStep(new Set(['identifiers_entered', 'discovery_found']))?.[0]).toBe(
      'confirm_grid_done',
    );
    expect(
      nextUnfinishedStep(
        new Set([
          'identifiers_entered',
          'discovery_found',
          'confirm_grid_done',
          'first_court_day_view',
          'first_alert',
          'first_brief',
          'whatsapp_linked',
          'invite_sent',
        ]),
      ),
    ).toBeNull();
  });
});

describe('onboarding nudge: in-app', () => {
  it('nudges the next unfinished step only, once, and not again within the gap', () =>
    run(async (f) => {
      await f.steps('signed_up', 'workspace_created', 'identifiers_entered');
      const first = await f.run();
      expect(first.nudged).toBeGreaterThanOrEqual(1);
      expect(await f.titles()).toEqual(['Find your cases']);
      // Same day again, then the next day: nothing new (same step, and inside the gap).
      await f.run();
      await f.run({}, new Date(MORNING.getTime() + DAY));
      expect(await f.titles()).toEqual(['Find your cases']);
      // The step is reached, and the gap has passed (`notify` stamps the real clock, so backdate
      // the first row to the fake one): the next step is nudged.
      await inWorkspace(f.tx, f.workspaceId, (s) =>
        s.update(schema.notification).set({ createdAt: MORNING }),
      );
      await f.tx
        .insert(schema.activationEvent)
        .values({ userId: f.userId, step: 'discovery_found', occurredAt: MORNING });
      await f.run({}, new Date(MORNING.getTime() + 4 * DAY));
      expect((await f.titles()).sort()).toEqual(['Confirm your cases', 'Find your cases']);
    }));

  it('sends nothing for a user who signed up less than two days ago or has no workspace', () =>
    run(async (f) => {
      await f.tx.insert(schema.activationEvent).values({
        userId: f.userId,
        step: 'signed_up',
        occurredAt: new Date(MORNING.getTime() - DAY),
      });
      await f.run();
      expect(await f.titles()).toEqual([]);
    }));

  it('is dark: nothing is sent while the flag is off', () =>
    run(async (f) => {
      await f.steps('signed_up');
      await f.run({ flagEnabled: () => Promise.resolve(false) });
      expect(await f.titles()).toEqual([]);
    }));
});

describe('onboarding nudge: WhatsApp', () => {
  it("sends the template link to the member's own number when they chose the category", () =>
    run(async (f) => {
      const { sent, whatsapp } = spy();
      await f.steps('signed_up');
      await f.link(['onboarding.nudge']);
      await f.run({ whatsapp });
      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe('+919800000004');
      expect(sent[0]?.message.category).toBe('onboarding.nudge');
      expect(sent[0]?.message.params).toEqual([`https://app.causedeck.test/w/${f.slug}`]);
      // A second run sends nothing more.
      await f.run({ whatsapp });
      expect(sent).toHaveLength(1);
    }));

  it('sends nothing without a link, without the category, or inside court hours', async () => {
    await run(async (f) => {
      const { sent, whatsapp } = spy();
      await f.steps('signed_up');
      await f.run({ whatsapp });
      expect(sent).toHaveLength(0);
      expect(await f.titles()).toHaveLength(1);
    });
    await run(async (f) => {
      const { sent, whatsapp } = spy();
      await f.steps('signed_up');
      await f.link(['digest.end_of_day']);
      await f.run({ whatsapp });
      expect(sent).toHaveLength(0);
    });
    await run(async (f) => {
      const { sent, whatsapp } = spy();
      await f.steps('signed_up');
      await f.link(['onboarding.nudge']);
      await f.run({ whatsapp }, COURT_HOURS);
      expect(sent).toHaveLength(0);
      expect(await f.titles()).toHaveLength(1);
    });
  });

  it('uses the mock sender when the provider env is absent, and a failure does not stop the nudge', async () => {
    await run(async (f) => {
      setNotificationJobDeps({
        appUrl: 'https://app.causedeck.test',
        email: { provider: 'console', send: () => Promise.resolve({}) },
      });
      await f.steps('signed_up');
      await f.link(['onboarding.nudge']);
      const report = await f.run();
      expect(report.whatsapp).toBe(1);
    });
    await run(async (f) => {
      const failing: WhatsAppSender = { send: () => Promise.reject(new Error('rejected')) };
      await f.steps('signed_up');
      await f.link(['onboarding.nudge']);
      const report = await f.run({ whatsapp: failing });
      expect(report.nudged).toBeGreaterThanOrEqual(1);
      expect(report.whatsapp).toBe(0);
      expect(await f.titles()).toHaveLength(1);
    });
  });
});
