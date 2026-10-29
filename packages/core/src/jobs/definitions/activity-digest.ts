// The end-of-day digest, "What CauseDeck did today" (#49; docs/product/09 §6, §8.6; PRD TR-2).
// Three jobs, so one failing member never re-sends another's digest:
// - `system.activity.digest` runs every half hour from 18:00 to 23:30 (cron in `Asia/Kolkata`) and
//   enqueues `activity.digest` for every live workspace whose local time is inside an evening slot.
//   It has no workspace and the tenant tables are under FORCE RLS, so it lists targets (ids and
//   timezone only) through the owner-defined `app_notification_digest_targets` function.
// - `activity.digest` (one workspace, one local day, one slot) finds the active members whose
//   `digest.end_of_day` time is that slot and who have the digest on, and enqueues one
//   `activity.digest.member` each.
// - `activity.digest.member` builds that member's digest from counts only (`countDigestActivities`:
//   L3 actions still undoable, open L2 proposals; sensitive and unreadable matters left out), then
//   writes the in-app notification and sends the email through the transport of #23 (console in dev,
//   SES later). Idempotent per `(userId, localDate)` (`once`); a failed send is retried with
//   backoff and then dead-lettered by the queue; a permanent failure (a rejected address) is not.
// Nothing is sent for a day with no activity and nothing pending. The digest is addressed only to
// the member, links only open the app and carry no action that changes anything, and it never holds
// document content, commitments or advice. Names appear only if the member turned `includeNames` on.
import { schema } from '@causedeck/db';
import {
  buildEndOfDayDigest,
  endOfDaySlot,
  getEndOfDayPreference,
  getPreferences,
  isQuietTime,
  localDayBounds,
  localMinutes,
  notify,
} from '@causedeck/notifications';
import {
  emailErrorCode,
  getTranslator,
  isPermanentEmailError,
  isSuppressed,
  preferencesUrl,
  renderEmail,
  toEmailLocale,
} from '@causedeck/notifications/email';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { countAttention } from '../../attention/index.ts';
import { countDigestActivities } from '../../automation/index.ts';
import { getWhatsAppSendTarget } from '../../whatsapp-link/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { once } from '../idempotency.ts';
import { getProducer } from '../producer.ts';

import {
  appLink,
  notificationJobDeps,
  workspaceTimezone,
  type NotificationJobDeps,
} from './notification-deliver.ts';

const { member, organization, user } = schema;

const slotSchema = z.string().regex(/^\d{2}:(00|30)$/);

export const activityDigestSchema = z.object({
  workspaceId: workspaceIdSchema,
  /** The local day the digest covers, `YYYY-MM-DD`. */
  localDate: z.iso.date(),
  /** The half hour the scheduler fired in, `HH:MM`. */
  slot: slotSchema,
});
export type ActivityDigestPayload = z.output<typeof activityDigestSchema>;

export const activityDigestMemberSchema = z.object({
  workspaceId: workspaceIdSchema,
  userId: z.uuid(),
  localDate: z.iso.date(),
});
export type ActivityDigestMemberPayload = z.output<typeof activityDigestMemberSchema>;

const workspaceKey = (p: ActivityDigestPayload) => `${p.workspaceId}:${p.localDate}:${p.slot}`;
const memberKey = (p: ActivityDigestMemberPayload) => `eod:${p.userId}:${p.localDate}`;

// --- scheduler -------------------------------------------------------------------------------

export interface ActivityDigestTarget {
  workspaceId: string;
  localDate: string;
  slot: string;
}

export interface ActivityDigestScheduleDeps {
  now?: () => Date;
  enqueue?: (target: ActivityDigestTarget) => Promise<unknown>;
}

/** Send one `activity.digest` job as the registry's `enqueue` does (schema, singleton, fairness). */
async function enqueueWorkspace(target: ActivityDigestTarget): Promise<unknown> {
  const data = activityDigestSchema.parse(target);
  const sender = await getProducer();
  return sender.send('activity.digest', data, {
    singletonKey: workspaceKey(data),
    group: { id: data.workspaceId },
  });
}

/** Enqueue the digest for every workspace whose local time is inside an evening slot. */
export async function runActivityDigestSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: ActivityDigestScheduleDeps = {},
): Promise<ActivityDigestTarget[]> {
  const now = deps.now?.() ?? new Date();
  const send = deps.enqueue ?? enqueueWorkspace;
  const rows = await ctx.db.execute<{ workspace_id: string; timezone: string }>(
    sql`select workspace_id::text, timezone from app_notification_digest_targets()`,
  );
  const due: ActivityDigestTarget[] = [];
  for (const row of rows) {
    const slot = endOfDaySlot(now, row.timezone);
    if (slot === null) continue;
    const target = { workspaceId: row.workspace_id, ...slot };
    await send(target);
    due.push(target);
  }
  ctx.log.info({ workspaces: rows.length, enqueued: due.length }, 'activity digests scheduled');
  return due;
}

export const activityDigestSchedule = defineJob({
  name: 'system.activity.digest',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'activity-digest', policy: 'stately' },
  // Every half hour from 18:00 to 23:30 in Asia/Kolkata; a member's own time picks the slot.
  schedule: { cron: '0,30 18-23 * * *', payload: {} },
  handler: async (ctx) => {
    await runActivityDigestSchedule(ctx);
  },
});

// --- per workspace ---------------------------------------------------------------------------

export interface ActivityDigestFanOutDeps {
  now?: () => Date;
  enqueue?: (payload: ActivityDigestMemberPayload) => Promise<unknown>;
}

async function enqueueMember(payload: ActivityDigestMemberPayload): Promise<unknown> {
  const data = activityDigestMemberSchema.parse(payload);
  const sender = await getProducer();
  return sender.send('activity.digest.member', data, {
    singletonKey: memberKey(data),
    group: { id: data.workspaceId },
  });
}

/** Enqueue a member digest for every active member who has the digest on at `slot`. */
export async function runActivityDigest(
  ctx: JobContext,
  { workspaceId, localDate, slot }: ActivityDigestPayload,
  deps: ActivityDigestFanOutDeps = {},
): Promise<{ due: number; skippedDisabled: number }> {
  const send = deps.enqueue ?? enqueueMember;
  const members = await ctx.db
    .select({ userId: member.userId })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.status, 'active'),
        isNull(organization.deletedAt),
      ),
    );
  let due = 0;
  let skippedDisabled = 0;
  for (const m of members) {
    const pref = await ctx.db.transaction((sp) =>
      getEndOfDayPreference({ db: sp, workspaceId }, { userId: m.userId }),
    );
    if (!pref.enabled) {
      skippedDisabled += 1;
      continue;
    }
    if (pref.time !== slot) continue;
    await send({ workspaceId, userId: m.userId, localDate });
    due += 1;
  }
  ctx.log.info({ workspaceId, localDate, slot, due, skippedDisabled }, 'activity digest fan-out');
  return { due, skippedDisabled };
}

export const activityDigest = defineJob({
  name: 'activity.digest',
  schema: activityDigestSchema,
  concurrency: 2,
  retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
  singleton: { key: workspaceKey },
  handler: async (ctx, payload) => {
    await runActivityDigest(ctx, payload);
  },
});

// --- per member ------------------------------------------------------------------------------

export type MemberDigestOutcome =
  | 'sent'
  | 'skippedEmpty'
  | 'skippedDisabled'
  | 'skippedSuppressed'
  | 'skippedNotMember'
  | 'alreadySent'
  | 'failed';

/** Build and deliver one member's digest for `localDate`. Exported for tests. */
export async function runActivityDigestMember(
  ctx: JobContext,
  { workspaceId, userId, localDate }: ActivityDigestMemberPayload,
  deps: NotificationJobDeps = notificationJobDeps(ctx.log),
): Promise<MemberDigestOutcome> {
  const timeZone = await workspaceTimezone(ctx, workspaceId);
  const { start, end } = localDayBounds(localDate, timeZone);
  const [row] = await ctx.db
    .select({
      email: user.email,
      locale: user.locale,
      slug: organization.slug,
      isDemo: organization.isDemo,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.userId, userId),
        eq(member.status, 'active'),
        isNull(organization.deletedAt),
      ),
    );
  if (row === undefined) return 'skippedNotMember';
  // A demo workspace sends nothing outside it (#93).
  if (row.isDemo) return 'skippedDisabled';

  const notificationCtx = { db: ctx.db, workspaceId };
  const pref = await getEndOfDayPreference(notificationCtx, { userId });
  if (!pref.enabled) return 'skippedDisabled';
  const prefs = await getPreferences(notificationCtx, { userId });
  const channelOn = (channel: 'in_app' | 'email' | 'whatsapp') =>
    prefs.some((p) => p.category === 'digest.end_of_day' && p.channel === channel && p.enabled);

  const counts = await countDigestActivities(
    { db: ctx.db, events: { emit() {} }, ...(deps.now === undefined ? {} : { now: deps.now }) },
    { workspaceId, userId },
    { from: start, to: end, includeNames: pref.includeNames },
  );
  // Stale-matter flags the member may see (#70): a count only, never a title or evidence. It rides
  // on a digest that is already due and never makes an empty day send.
  const attentionCount = await countAttention(
    { db: ctx.db, ...(deps.now === undefined ? {} : { now: deps.now }) },
    { workspaceId, userId },
  ).catch(() => 0);
  const digest = buildEndOfDayDigest({
    localDate,
    userId,
    workspaceSlug: row.slug,
    l3Count: counts.l3Count,
    pendingL2Count: counts.pendingL2Count,
    includeNames: pref.includeNames,
    matterTitles: counts.matterTitles,
  });
  if (digest === null) return 'skippedEmpty';

  const emailing = channelOn('email');
  if (emailing && (await isSuppressed(ctx.db, row.email))) return 'skippedSuppressed';

  // The evening summary on WhatsApp (#679): only to the member's own verified number, only when
  // they chose it for this digest, never inside court hours, counts and a link only. A failure is
  // logged and never retried, and it runs after the email so a retried email never resends it.
  const sendWhatsAppSummary = async (): Promise<void> => {
    const whatsapp = deps.whatsapp;
    if (whatsapp === undefined || !channelOn('whatsapp')) return;
    try {
      if (
        isQuietTime(localMinutes(deps.now?.() ?? new Date(), timeZone), { courtHoursQuiet: true })
      ) {
        return;
      }
      const target = await getWhatsAppSendTarget(
        { db: ctx.db },
        { userId, workspaceId },
        { category: 'digest.end_of_day' },
      );
      if (target === null) return;
      await whatsapp.send(
        {
          category: 'digest.end_of_day',
          params: [
            String(digest.l3Count),
            String(digest.pendingL2Count),
            appLink(deps.appUrl, digest.links.activity),
          ],
        },
        target,
      );
    } catch (error) {
      ctx.log.warn(
        { workspaceId, userId, code: emailErrorCode(error) },
        'end-of-day digest whatsapp failed',
      );
    }
  };

  const result = await once(ctx, memberKey({ workspaceId, userId, localDate }), async () => {
    const locale = toEmailLocale(row.locale);
    const props = {
      l3Count: digest.l3Count,
      pendingL2Count: digest.pendingL2Count,
      activityUrl: appLink(deps.appUrl, digest.links.activity),
      inboxUrl: appLink(deps.appUrl, digest.links.inbox),
      matterTitles: digest.matterTitles,
      preferencesUrl: preferencesUrl(deps.appUrl),
    };
    const email = await renderEmail('end-of-day-digest', props, locale);
    if (channelOn('in_app')) {
      const t = await getTranslator(locale);
      // The email below is this digest's own; `notify` must not queue the generic notice email.
      await notify(
        { ...notificationCtx, enqueueDelivery: () => Promise.resolve(undefined) },
        {
          userId,
          category: 'digest.end_of_day',
          title: email.subject,
          body: `${t('endOfDayDigest.applied', { count: digest.l3Count })} ${t('endOfDayDigest.pending', { count: digest.pendingL2Count })}${attentionCount > 0 ? ` ${t('endOfDayDigest.attention', { count: attentionCount })}` : ''}`,
          href: digest.links.activity,
          dedupeKey: `eod:${localDate}`,
        },
      );
    }
    if (!emailing) {
      await sendWhatsAppSummary();
      return 'sent' as const;
    }
    try {
      await deps.email.send({
        to: row.email,
        ...email,
        tags: { template: 'end-of-day-digest' },
      });
      await sendWhatsAppSummary();
      return 'sent' as const;
    } catch (error) {
      const code = emailErrorCode(error);
      ctx.log.warn(
        { workspaceId, userId, code, permanent: isPermanentEmailError(error) },
        'end-of-day digest email failed',
      );
      if (isPermanentEmailError(error)) {
        await sendWhatsAppSummary();
        return 'failed' as const;
      }
      throw new RetryableError(
        'ACTIVITY_DIGEST_RETRY',
        `digest email failed (${code}); will retry`,
      );
    }
  });
  return result.skipped ? 'alreadySent' : result.value;
}

export const activityDigestMember = defineJob({
  name: 'activity.digest.member',
  schema: activityDigestMemberSchema,
  concurrency: 4,
  retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
  singleton: { key: memberKey },
  idempotencyKey: memberKey,
  handler: async (ctx, payload) => {
    const outcome = await runActivityDigestMember(ctx, payload);
    ctx.log.info({ workspaceId: payload.workspaceId, outcome }, 'activity digest member done');
  },
});
