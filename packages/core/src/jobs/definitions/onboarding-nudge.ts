// Onboarding nudges (#601, deferred from #509 R5): once a morning, `system.onboarding.nudge`
// reminds a user of the next setup step they have not reached, in the app and, if they chose it,
// on WhatsApp. It reads `activation_event` (global, ids and a closed step list only) and writes
// nothing of its own: the in-app `notify` dedupe key (`onboarding:<step>`) is the once-per-step
// record, so there is no table. Rules:
// - dark behind `growth.onboarding-nudge` (kill switch `KILL_GROWTH_ONBOARDING_NUDGE`), judged on
//   the workspace that hosts the nudge: the user's first active, non-demo membership;
// - only users who signed up between `MIN_AGE_DAYS` and `MAX_AGE_DAYS` ago, one nudge per user per
//   `MIN_GAP_DAYS`, and one per step ever;
// - WhatsApp only to the user's own verified number and only when they chose `onboarding.nudge`
//   on their WhatsApp link (`getWhatsAppSendTarget`), never inside court hours, a link and no
//   text. It runs on the mock sender when the provider env is absent; a failure is logged and
//   never retried. Live sends wait for the provider to approve the template (owner action).
import { isEnabled } from '@causedeck/flags';
import { schema, withUser, withWorkspace } from '@causedeck/db';
import { isQuietTime, localMinutes, notify } from '@causedeck/notifications';
import { emailErrorCode } from '@causedeck/notifications/email';
import { createMockWhatsAppSender, type WhatsAppSender } from '@causedeck/notifications/whatsapp';
import { and, asc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';

import { getWhatsAppSendTarget } from '../../whatsapp-link/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';

import {
  appLink,
  notificationJobDeps,
  workspaceTimezone,
  type NotificationJobDeps,
} from './notification-deliver.ts';

const { activationEvent, member, notification, organization } = schema;

export const ONBOARDING_NUDGE_FLAG = 'growth.onboarding-nudge';
const CATEGORY = 'onboarding.nudge';
const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_AGE_DAYS = 2;
export const MAX_AGE_DAYS = 30;
export const MIN_GAP_DAYS = 3;
const MAX_USERS = 500;

/** The steps a nudge can ask for, in funnel order, with the in-app text. */
export const NUDGE_STEPS = [
  ['identifiers_entered', 'Add your first case', 'Enter a case number so CauseDeck can follow it.'],
  ['discovery_found', 'Find your cases', 'Let CauseDeck look for your cases in the court lists.'],
  ['confirm_grid_done', 'Confirm your cases', 'Check the cases CauseDeck found and confirm yours.'],
  ['first_court_day_view', 'Open your court day', "See tomorrow's list in one place."],
  ['first_alert', 'Turn on an alert', 'Get told when a listed date or order changes.'],
  ['first_brief', 'Read your first brief', 'Your hearing brief is ready to read.'],
  ['whatsapp_linked', 'Link WhatsApp', 'Get court-day updates on WhatsApp, if you want them.'],
  ['invite_sent', 'Invite a colleague', 'Bring your clerk or junior onto the same cases.'],
] as const satisfies readonly (readonly [schema.ActivationStep, string, string])[];

/** The next step `done` has not reached, or null when every nudgeable step is done. */
export function nextUnfinishedStep(done: ReadonlySet<string>): (typeof NUDGE_STEPS)[number] | null {
  return NUDGE_STEPS.find(([step]) => !done.has(step)) ?? null;
}

export interface OnboardingNudgeDeps extends Partial<Pick<NotificationJobDeps, 'now' | 'appUrl'>> {
  whatsapp?: WhatsAppSender | undefined;
  flagEnabled?: (workspaceId: string) => Promise<boolean>;
}

export interface OnboardingNudgeReport {
  considered: number;
  nudged: number;
  whatsapp: number;
  skipped: number;
}

type Outcome = 'nudged' | 'skipped';

async function nudgeUser(
  ctx: JobContext,
  userId: string,
  done: ReadonlySet<string>,
  now: Date,
  deps: OnboardingNudgeDeps,
  base: NotificationJobDeps,
): Promise<{ outcome: Outcome; whatsapp: boolean }> {
  const skipped = { outcome: 'skipped', whatsapp: false } as const;
  const next = nextUnfinishedStep(done);
  if (next === null) return skipped;
  const [step, title, body] = next;

  const home = await withUser(ctx.db, { userId }, async (tx) => {
    const [row] = await tx
      .select({ workspaceId: member.organizationId, slug: organization.slug })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(member.userId, userId),
          eq(member.status, 'active'),
          eq(organization.isDemo, false),
          isNull(organization.deletedAt),
        ),
      )
      .orderBy(asc(member.createdAt))
      .limit(1);
    return row;
  });
  if (home === undefined) return skipped;
  const { workspaceId, slug } = home;
  const flag =
    deps.flagEnabled ?? ((id: string) => isEnabled(ONBOARDING_NUDGE_FLAG, { workspaceId: id }));
  if (!(await flag(workspaceId))) return skipped;

  const dedupeKey = `onboarding:${step}`;
  const recent = await withWorkspace(ctx.db, { workspaceId, userId }, (tx) =>
    tx
      .select({ dedupeKey: notification.dedupeKey })
      .from(notification)
      .where(
        and(
          eq(notification.workspaceId, workspaceId),
          eq(notification.userId, userId),
          eq(notification.category, CATEGORY),
          gt(notification.createdAt, new Date(now.getTime() - MIN_GAP_DAYS * DAY_MS)),
        ),
      )
      .limit(1),
  );
  if (recent.length > 0) return skipped;
  const already = await withWorkspace(ctx.db, { workspaceId, userId }, (tx) =>
    tx
      .select({ id: notification.id })
      .from(notification)
      .where(
        and(
          eq(notification.workspaceId, workspaceId),
          eq(notification.userId, userId),
          eq(notification.dedupeKey, dedupeKey),
        ),
      )
      .limit(1),
  );
  if (already.length > 0) return skipped;

  const href = `/w/${slug}`;
  // The in-app row only: WhatsApp below has its own gate, so no delivery job is enqueued here.
  await notify(
    { db: ctx.db, workspaceId, enqueueDelivery: () => Promise.resolve(undefined) },
    { userId, category: CATEGORY, title, body, href, dedupeKey },
  );

  let whatsapp = false;
  try {
    const timeZone = await workspaceTimezone(ctx, workspaceId);
    if (!isQuietTime(localMinutes(now, timeZone), { courtHoursQuiet: true })) {
      const target = await getWhatsAppSendTarget(
        { db: ctx.db },
        { userId, workspaceId },
        { category: CATEGORY },
      );
      if (target !== null) {
        const sender = deps.whatsapp ?? base.whatsapp ?? createMockWhatsAppSender({ log: ctx.log });
        await sender.send(
          { category: CATEGORY, params: [appLink(deps.appUrl ?? base.appUrl, href)] },
          target,
        );
        whatsapp = true;
      }
    }
  } catch (error) {
    ctx.log.warn(
      { workspaceId, userId, code: emailErrorCode(error) },
      'onboarding nudge whatsapp failed',
    );
  }
  return { outcome: 'nudged', whatsapp };
}

/** Nudge every user whose next setup step is unfinished. Exported for tests. */
export async function runOnboardingNudge(
  ctx: JobContext,
  deps: OnboardingNudgeDeps = {},
): Promise<OnboardingNudgeReport> {
  const base = notificationJobDeps(ctx.log);
  const now = (deps.now ?? base.now)?.() ?? new Date();
  const signedUp = await ctx.db
    .select({ userId: activationEvent.userId })
    .from(activationEvent)
    .where(
      and(
        eq(activationEvent.step, 'signed_up'),
        lte(activationEvent.occurredAt, new Date(now.getTime() - MIN_AGE_DAYS * DAY_MS)),
        gt(activationEvent.occurredAt, new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS)),
      ),
    )
    .orderBy(asc(activationEvent.occurredAt))
    .limit(MAX_USERS);
  const userIds = signedUp.map((r) => r.userId);
  const report: OnboardingNudgeReport = {
    considered: userIds.length,
    nudged: 0,
    whatsapp: 0,
    skipped: 0,
  };
  if (userIds.length === 0) return report;

  const events = await ctx.db
    .select({ userId: activationEvent.userId, step: activationEvent.step })
    .from(activationEvent)
    .where(inArray(activationEvent.userId, userIds));
  const doneBy = new Map<string, Set<string>>();
  for (const e of events) {
    const set = doneBy.get(e.userId) ?? new Set<string>();
    set.add(e.step);
    doneBy.set(e.userId, set);
  }

  for (const userId of userIds) {
    try {
      const result = await nudgeUser(
        ctx,
        userId,
        doneBy.get(userId) ?? new Set(),
        now,
        { ...deps, now: () => now },
        base,
      );
      if (result.outcome === 'nudged') report.nudged += 1;
      else report.skipped += 1;
      if (result.whatsapp) report.whatsapp += 1;
    } catch (error) {
      // One user's failure never stops the rest, and the nudge is not retried.
      report.skipped += 1;
      ctx.log.warn({ userId, code: emailErrorCode(error) }, 'onboarding nudge failed');
    }
  }
  ctx.log.info({ ...report }, 'onboarding nudges sent');
  return report;
}

export const onboardingNudge = defineJob({
  name: 'system.onboarding.nudge',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  retry: { limit: 0 },
  singleton: { key: () => 'onboarding-nudge', policy: 'stately' },
  // 09:30 in Asia/Kolkata every day.
  schedule: { cron: '30 9 * * *', payload: {} },
  handler: async (ctx) => {
    await runOnboardingNudge(ctx);
  },
});
