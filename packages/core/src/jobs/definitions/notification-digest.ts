// The daily digest (#196, #23; PRD TR-2). Two jobs:
// - `system.notification.digest` runs every half hour (cron evaluated in `Asia/Kolkata` by the
//   worker) and enqueues `notification.digest` for each live workspace whose local time is in the
//   18:30 slot. It has no workspace, and `organization`/`workspace_settings` are under FORCE RLS,
//   so it lists targets (ids and timezone only) through the owner-defined
//   `app_notification_digest_targets` function (0013_notification_digest).
// - `notification.digest` emails each active member one digest of the notifications they asked to
//   receive daily (email channel set to `daily`) since the previous 18:30. It sends nothing when
//   there is nothing to report, when the member turned the digest email off, when the address is
//   suppressed, or inside the member's configured quiet hours (`notification_setting`). One send
//   per member and day (`once()`), each in its own savepoint so one failure never re-sends others.
// The timezone is the workspace's (`workspace_settings.timezone`, default `Asia/Kolkata`): users
// have no timezone of their own. Composing digest content from domain events is out of scope.
import { schema } from '@causedeck/db';
import {
  getPreferences,
  isQuietTime,
  localMinutes,
  type CategoryKey,
} from '@causedeck/notifications';
import {
  emailErrorCode,
  isPermanentEmailError,
  isSuppressed,
  preferencesUrl,
  renderEmail,
  toEmailLocale,
} from '@causedeck/notifications/email';
import { and, desc, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { once } from '../idempotency.ts';
import { getProducer } from '../producer.ts';
import { appLink, notificationJobDeps, type NotificationJobDeps } from './notification-deliver.ts';

const { member, notification, notificationSetting, organization, user, workspaceSettings } = schema;

/** Local time the digest goes out. */
export const DIGEST_LOCAL_TIME = '18:30';
export const DEFAULT_DIGEST_TIMEZONE = 'Asia/Kolkata';
/** Items listed in one digest email; older ones are summarised by the count. */
export const DIGEST_ITEM_LIMIT = 50;

const [DIGEST_HOUR, DIGEST_MINUTE] = DIGEST_LOCAL_TIME.split(':').map(Number) as [number, number];
const DIGEST_MINUTES = DIGEST_HOUR * 60 + DIGEST_MINUTE;
/** The scheduler fires every 30 minutes, so the slot is [18:30, 19:00). */
const SLOT_MINUTES = 30;

function validZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_DIGEST_TIMEZONE;
  }
}

/** Local calendar date `YYYY-MM-DD` of `date` in `timeZone`. */
function localDate(date: Date, timeZone: string): string {
  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** The digest date when `now` is inside the 18:30 slot in `timeZone`, else `null`. */
export function digestDueAt(now: Date, timeZone: string): string | null {
  const zone = validZone(timeZone);
  const minutes = localMinutes(now, zone);
  if (minutes < DIGEST_MINUTES || minutes >= DIGEST_MINUTES + SLOT_MINUTES) return null;
  return localDate(now, zone);
}

/** The instant of `digestDate` at 18:30 in `timeZone`. */
export function digestInstant(digestDate: string, timeZone: string): Date {
  const zone = validZone(timeZone);
  const [y = 0, m = 1, d = 1] = digestDate.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, DIGEST_HOUR, DIGEST_MINUTE);
  // Offset of the zone at that moment: local wall time read back as UTC, minus the instant.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'));
  return new Date(guess - (wall - guess));
}

// --- scheduler -------------------------------------------------------------------------------

export const notificationDigestSchema = z.object({
  workspaceId: workspaceIdSchema,
  digestDate: z.iso.date(),
});

export type NotificationDigestPayload = z.output<typeof notificationDigestSchema>;

export interface DigestTarget {
  workspaceId: string;
  digestDate: string;
}

export interface DigestScheduleDeps {
  now?: () => Date;
  enqueue?: (target: DigestTarget) => Promise<unknown>;
}

const digestKey = (p: DigestTarget) => `${p.workspaceId}:${p.digestDate}`;

/**
 * Send one `notification.digest` job as the registry's `enqueue` does (schema, singleton key,
 * workspace fairness group). The registry imports this file, so it cannot be imported here.
 */
async function enqueueDigest(target: DigestTarget): Promise<unknown> {
  const data = notificationDigestSchema.parse(target);
  const sender = await getProducer();
  return sender.send('notification.digest', data, {
    singletonKey: digestKey(data),
    group: { id: data.workspaceId },
  });
}

/** Enqueue the digest for every workspace whose local time is in the 18:30 slot. */
export async function runNotificationDigestSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: DigestScheduleDeps = {},
): Promise<DigestTarget[]> {
  const now = deps.now?.() ?? new Date();
  const send = deps.enqueue ?? enqueueDigest;
  const rows = await ctx.db.execute<{ workspace_id: string; timezone: string }>(
    sql`select workspace_id::text, timezone from app_notification_digest_targets()`,
  );
  const due: DigestTarget[] = [];
  for (const row of rows) {
    const digestDate = digestDueAt(now, row.timezone);
    if (digestDate === null) continue;
    const target = { workspaceId: row.workspace_id, digestDate };
    await send(target);
    due.push(target);
  }
  ctx.log.info({ workspaces: rows.length, enqueued: due.length }, 'notification digests scheduled');
  return due;
}

export const notificationDigestSchedule = defineJob({
  name: 'system.notification.digest',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'notification-digest', policy: 'stately' },
  // Every half hour in Asia/Kolkata; each workspace gets its digest at 18:30 local time.
  schedule: { cron: '0,30 * * * *', payload: {} },
  handler: async (ctx) => {
    await runNotificationDigestSchedule(ctx);
  },
});

// --- per-workspace digest --------------------------------------------------------------------

export interface DigestReport {
  sent: number;
  skippedEmpty: number;
  skippedQuiet: number;
  skippedSuppressed: number;
  skippedDisabled: number;
  alreadySent: number;
  failed: number;
}

type MemberOutcome = keyof DigestReport;

const DAY_MS = 24 * 60 * 60 * 1000;

async function workspaceTimezone(ctx: Pick<JobContext, 'db'>, workspaceId: string) {
  const [row] = await ctx.db
    .select({ timezone: workspaceSettings.timezone })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId));
  return validZone(row?.timezone ?? DEFAULT_DIGEST_TIMEZONE);
}

/** Send the day's digest to every active member of the workspace. Exported for tests. */
export async function runNotificationDigest(
  ctx: JobContext,
  { workspaceId, digestDate }: NotificationDigestPayload,
  deps: NotificationJobDeps = notificationJobDeps(ctx.log),
): Promise<DigestReport> {
  const now = deps.now?.() ?? new Date();
  const timeZone = await workspaceTimezone(ctx, workspaceId);
  const end = digestInstant(digestDate, timeZone);
  const start = new Date(end.getTime() - DAY_MS);
  const nowMinutes = localMinutes(now, timeZone);

  const members = await ctx.db
    .select({ userId: member.userId, email: user.email, locale: user.locale })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.status, 'active'),
        isNull(organization.deletedAt),
      ),
    );

  const report: DigestReport = {
    sent: 0,
    skippedEmpty: 0,
    skippedQuiet: 0,
    skippedSuppressed: 0,
    skippedDisabled: 0,
    alreadySent: 0,
    failed: 0,
  };

  for (const m of members) {
    const outcome = await ctx.db.transaction(async (sp): Promise<MemberOutcome> => {
      const scoped = { ...ctx, db: sp };
      const prefs = await getPreferences({ db: sp, workspaceId }, { userId: m.userId });
      const digestPref = prefs.find((p) => p.category === 'digest.daily' && p.channel === 'email');
      if (digestPref?.enabled !== true) return 'skippedDisabled';

      const daily: CategoryKey[] = prefs
        .filter((p) => p.channel === 'email' && p.enabled && p.digest === 'daily')
        .map((p) => p.category);
      const items =
        daily.length === 0
          ? []
          : await sp
              .select({ title: notification.title, href: notification.href })
              .from(notification)
              .where(
                and(
                  eq(notification.workspaceId, workspaceId),
                  eq(notification.userId, m.userId),
                  inArray(notification.category, daily),
                  gt(notification.createdAt, start),
                  lte(notification.createdAt, end),
                ),
              )
              .orderBy(desc(notification.createdAt))
              .limit(DIGEST_ITEM_LIMIT);
      if (items.length === 0) return 'skippedEmpty';

      const [setting] = await sp
        .select({ courtHoursQuiet: notificationSetting.courtHoursQuiet })
        .from(notificationSetting)
        .where(
          and(
            eq(notificationSetting.workspaceId, workspaceId),
            eq(notificationSetting.userId, m.userId),
          ),
        );
      if (isQuietTime(nowMinutes, setting)) return 'skippedQuiet';
      if (await isSuppressed(sp, m.email)) return 'skippedSuppressed';

      const result = await once(scoped, `digest:${m.userId}:${digestDate}`, async () => {
        const email = await renderEmail(
          'daily-digest',
          {
            items: items.map((i) => ({ title: i.title, href: appLink(deps.appUrl, i.href) })),
            appUrl: deps.appUrl,
            preferencesUrl: preferencesUrl(deps.appUrl),
          },
          toEmailLocale(m.locale),
        );
        try {
          await deps.email.send({ to: m.email, ...email, tags: { template: 'daily-digest' } });
          return 'sent' as const;
        } catch (error) {
          ctx.log.warn(
            {
              workspaceId,
              userId: m.userId,
              code: emailErrorCode(error),
              permanent: isPermanentEmailError(error),
            },
            'digest email failed',
          );
          return 'failed' as const;
        }
      });
      return result.skipped ? 'alreadySent' : result.value;
    });
    report[outcome] += 1;
  }

  ctx.log.info({ workspaceId, digestDate, ...report }, 'notification digest complete');
  return report;
}

export const notificationDigest = defineJob({
  name: 'notification.digest',
  schema: notificationDigestSchema,
  concurrency: 2,
  retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
  singleton: { key: digestKey },
  idempotencyKey: digestKey,
  handler: async (ctx, payload) => {
    await runNotificationDigest(ctx, payload);
  },
});
