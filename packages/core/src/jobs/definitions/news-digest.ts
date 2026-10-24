// The legal news digest (#481, D-048). Three jobs, as the end-of-day digest (`activity-digest.ts`):
// - `system.news.digest` runs every half hour (cron in `Asia/Kolkata`) and enqueues `news.digest`
//   for every live workspace and the half hour it is in locally. It lists targets through the
//   owner-defined `app_notification_digest_targets` function (no workspace, FORCE RLS tables).
// - `news.digest` (one workspace, one local day, one slot) enqueues `news.digest.member` for each
//   active member whose digest time is that slot and who has not had today's digest.
// - `news.digest.member` selects the items published since the member's last digest (their
//   followed practice areas and forums first) and sends them in-app, by email and by push. Nothing
//   is sent when there is nothing new. Idempotent per `(userId, localDate)` (`once`), so a member
//   gets at most one digest a day. Items carry the publisher and the link to the original; the
//   excerpt is the feed's own.
import { schema } from '@causedeck/db';
import { getPreferences, localDateOf, localDayBounds, notify } from '@causedeck/notifications';
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

import {
  getNewsPref,
  listNewsDigestRecipients,
  markNewsDigestSent,
  selectNewsDigestItems,
} from '../../news/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob, workspaceIdSchema } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { once } from '../idempotency.ts';
import { getProducer } from '../producer.ts';

import { appLink, notificationJobDeps, type NotificationJobDeps } from './notification-deliver.ts';

const { member, organization, user } = schema;

const slotSchema = z.string().regex(/^\d{2}:(00|30)$/);

export const newsDigestSchema = z.object({
  workspaceId: workspaceIdSchema,
  localDate: z.iso.date(),
  slot: slotSchema,
});
export type NewsDigestPayload = z.output<typeof newsDigestSchema>;

export const newsDigestMemberSchema = z.object({
  workspaceId: workspaceIdSchema,
  userId: z.uuid(),
  localDate: z.iso.date(),
});
export type NewsDigestMemberPayload = z.output<typeof newsDigestMemberSchema>;

const workspaceKey = (p: NewsDigestPayload) => `news:${p.workspaceId}:${p.localDate}:${p.slot}`;
const memberKey = (p: NewsDigestMemberPayload) => `news-digest:${p.userId}:${p.localDate}`;

/** The local date and the half hour (`HH:00` or `HH:30`) `now` falls in, in `timeZone`. */
export function newsDigestSlot(now: Date, timeZone: string): { localDate: string; slot: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { localDate: localDateOf(now, timeZone), slot: `${hour}:${minute < 30 ? '00' : '30'}` };
}

// --- scheduler -------------------------------------------------------------------------------

export interface NewsDigestTarget {
  workspaceId: string;
  localDate: string;
  slot: string;
}

export interface NewsDigestScheduleDeps {
  now?: () => Date;
  enqueue?: (target: NewsDigestTarget) => Promise<unknown>;
}

async function enqueueWorkspace(target: NewsDigestTarget): Promise<unknown> {
  const data = newsDigestSchema.parse(target);
  const sender = await getProducer();
  return sender.send('news.digest', data, {
    singletonKey: workspaceKey(data),
    group: { id: data.workspaceId },
  });
}

/** Enqueue `news.digest` for every live workspace and the slot it is in. */
export async function runNewsDigestSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: NewsDigestScheduleDeps = {},
): Promise<NewsDigestTarget[]> {
  const now = deps.now?.() ?? new Date();
  const send = deps.enqueue ?? enqueueWorkspace;
  const rows = await ctx.db.execute<{ workspace_id: string; timezone: string }>(
    sql`select workspace_id::text, timezone from app_notification_digest_targets()`,
  );
  const due: NewsDigestTarget[] = [];
  for (const row of rows) {
    const target = { workspaceId: row.workspace_id, ...newsDigestSlot(now, row.timezone) };
    await send(target);
    due.push(target);
  }
  ctx.log.info({ workspaces: rows.length, enqueued: due.length }, 'news digests scheduled');
  return due;
}

export const newsDigestSchedule = defineJob({
  name: 'system.news.digest',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'news-digest', policy: 'stately' },
  // Every half hour; a member's own digest time picks the slot.
  schedule: { cron: '0,30 * * * *', payload: {} },
  handler: async (ctx) => {
    await runNewsDigestSchedule(ctx);
  },
});

// --- per workspace ---------------------------------------------------------------------------

export interface NewsDigestFanOutDeps {
  enqueue?: (payload: NewsDigestMemberPayload) => Promise<unknown>;
}

async function enqueueMember(payload: NewsDigestMemberPayload): Promise<unknown> {
  const data = newsDigestMemberSchema.parse(payload);
  const sender = await getProducer();
  return sender.send('news.digest.member', data, {
    singletonKey: memberKey(data),
    group: { id: data.workspaceId },
  });
}

/** Enqueue a member digest for every member whose digest time is `slot` and who is still due. */
export async function runNewsDigest(
  ctx: JobContext,
  { workspaceId, localDate, slot }: NewsDigestPayload,
  deps: NewsDigestFanOutDeps = {},
): Promise<{ due: number }> {
  const send = deps.enqueue ?? enqueueMember;
  const userIds = await listNewsDigestRecipients({ db: ctx.db, workspaceId }, { slot, localDate });
  for (const userId of userIds) await send({ workspaceId, userId, localDate });
  ctx.log.info({ workspaceId, localDate, slot, due: userIds.length }, 'news digest fan-out');
  return { due: userIds.length };
}

export const newsDigest = defineJob({
  name: 'news.digest',
  schema: newsDigestSchema,
  concurrency: 2,
  retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
  singleton: { key: workspaceKey },
  handler: async (ctx, payload) => {
    await runNewsDigest(ctx, payload);
  },
});

// --- per member ------------------------------------------------------------------------------

export type NewsDigestOutcome =
  | 'sent'
  | 'skippedEmpty'
  | 'skippedNoPreference'
  | 'skippedSuppressed'
  | 'skippedNotMember'
  | 'alreadySent'
  | 'failed';

export interface NewsDigestMemberDeps extends NotificationJobDeps {
  enqueueDelivery?: (job: {
    workspaceId: string;
    notificationId: string;
    channel: 'email' | 'push';
  }) => Promise<unknown>;
}

async function workspaceZone(ctx: Pick<JobContext, 'db'>, workspaceId: string): Promise<string> {
  const rows = await ctx.db.execute<{ timezone: string }>(
    sql`select timezone from app_notification_digest_targets() where workspace_id = ${workspaceId}::uuid`,
  );
  return rows[0]?.timezone ?? 'Asia/Kolkata';
}

/** Build and deliver one member's news digest for `localDate`. Exported for tests. */
export async function runNewsDigestMember(
  ctx: JobContext,
  { workspaceId, userId, localDate }: NewsDigestMemberPayload,
  deps: NewsDigestMemberDeps = notificationJobDeps(ctx.log),
): Promise<NewsDigestOutcome> {
  const [row] = await ctx.db
    .select({ email: user.email, locale: user.locale, slug: organization.slug })
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

  const newsCtx = { db: ctx.db, workspaceId };
  const pref = await getNewsPref(newsCtx, { userId });
  if (pref === null) return 'skippedNoPreference';
  if (pref.lastDigestDate === localDate) return 'alreadySent';

  // Items since the last digest went out (that day at the member's digest time); a first digest
  // covers the last 24 hours.
  const now = deps.now?.() ?? new Date();
  const timeZone = await workspaceZone(ctx, workspaceId);
  let since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (pref.lastDigestDate !== null) {
    const [hh = 0, mm = 0] = pref.digestTime.split(':').map(Number);
    since = new Date(
      localDayBounds(pref.lastDigestDate, timeZone).start.getTime() + (hh * 60 + mm) * 60_000,
    );
  }
  const items = await selectNewsDigestItems(newsCtx, { userId, since });
  if (items.length === 0) return 'skippedEmpty';

  const prefs = await getPreferences(newsCtx, { userId });
  const channelOn = (channel: 'in_app' | 'email' | 'push') =>
    prefs.some((p) => p.category === 'digest.news' && p.channel === channel && p.enabled);
  const emailing = channelOn('email');
  if (emailing && (await isSuppressed(ctx.db, row.email))) return 'skippedSuppressed';

  const result = await once(ctx, memberKey({ workspaceId, userId, localDate }), async () => {
    const locale = toEmailLocale(row.locale);
    const href = `/w/${encodeURIComponent(row.slug)}/news`;
    const email = await renderEmail(
      'news-digest',
      {
        items: items.map((i) => ({
          title: i.title,
          url: i.url,
          sourceName: i.sourceName,
          excerpt: i.excerpt,
        })),
        newsUrl: appLink(deps.appUrl, href),
        preferencesUrl: preferencesUrl(deps.appUrl),
      },
      locale,
    );
    if (channelOn('in_app') || channelOn('push')) {
      const t = await getTranslator(locale);
      const { enqueueNotificationDelivery } = await import('../registry.ts');
      // `notify` queues the push; the email is this digest's own (the deliver job skips the
      // generic one for `digest.news`).
      await notify(
        {
          ...newsCtx,
          enqueueDelivery: deps.enqueueDelivery ?? ((job) => enqueueNotificationDelivery(job)),
        },
        {
          userId,
          category: 'digest.news',
          title: email.subject,
          body: items
            .slice(0, 3)
            .map((i) => `${i.title} (${t('newsDigest.source', { source: i.sourceName })})`)
            .join(' · '),
          href,
          dedupeKey: `news:${localDate}`,
        },
      );
    }
    if (emailing) {
      try {
        await deps.email.send({ to: row.email, ...email, tags: { template: 'news-digest' } });
      } catch (error) {
        const code = emailErrorCode(error);
        ctx.log.warn(
          { workspaceId, userId, code, permanent: isPermanentEmailError(error) },
          'news digest email failed',
        );
        if (isPermanentEmailError(error)) return 'failed' as const;
        throw new RetryableError('NEWS_DIGEST_RETRY', `digest email failed (${code}); will retry`);
      }
    }
    await markNewsDigestSent(newsCtx, { userId, localDate });
    return 'sent' as const;
  });
  return result.skipped ? 'alreadySent' : result.value;
}

export const newsDigestMember = defineJob({
  name: 'news.digest.member',
  schema: newsDigestMemberSchema,
  concurrency: 4,
  retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
  singleton: { key: memberKey },
  idempotencyKey: memberKey,
  handler: async (ctx, payload) => {
    const outcome = await runNewsDigestMember(ctx, payload);
    ctx.log.info({ workspaceId: payload.workspaceId, outcome }, 'news digest member done');
  },
});
