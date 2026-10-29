// Court-day reminders (#64, ADR 0039; docs/product/09 §6). Four jobs:
// - `system.reminder.schedule` runs every half hour from 07:00 to 23:30 (cron in `Asia/Kolkata`)
//   and, for every live workspace listed by the owner-defined `app_notification_digest_targets`
//   function, enqueues one member job per due reminder: the evening brief at the member's own
//   slot (18:00-23:00, default 20:00) for tomorrow, the morning diff at 07:00 for today and the
//   outcome-missing nudge each slot from 12:00 for today (the member job decides if it is due).
// - `reminder.evening`, `reminder.morning` and `reminder.outcome-missing` build one member's
//   reminder from the pure builders in `court-day/reminders.ts`, and send it on each channel the
//   member left on (`notification_pref` of the `reminder.*` category). Each channel first inserts a
//   `reminder_dispatch` row with ON CONFLICT DO NOTHING and sends only when a row was inserted, so a
//   retried job sends nothing twice; a failed send deletes its row and throws `RetryableError`
//   (backoff, then dead-lettered by the queue and shown in the admin health feed).
// A reminder with nothing to say (no listing, no change, no missing outcome) sends nothing. The
// recipient is always the email of an active member's own user: no client or external address is
// read. A push carries counts only through the generic title; names are in the in-app body only.
import { randomUUID } from 'node:crypto';

import { schema, withWorkspace } from '@causedeck/db';
import {
  getReminderPreferences,
  isQuietTime,
  localDayBounds,
  localMinutes,
  notify,
  type ReminderPreferences,
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
import { ReminderPayload, type ListDiff } from '@causedeck/validators';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { assembleBrief, computeReadiness } from '../../briefs/index.ts';
import {
  addDays,
  buildEveningBrief,
  buildMorningDiff,
  diffLists,
  eveningPushPayload,
  findMissingOutcomes,
  getCourtDay,
  type HearingForOutcome,
} from '../../court-day/index.ts';
import { isDemoWorkspace } from '../../shared/index.ts';
import type { JobContext } from '../context.ts';
import { defineJob } from '../define.ts';
import { RetryableError } from '../errors.ts';
import { getProducer } from '../producer.ts';

import {
  appLink,
  notificationJobDeps,
  workspaceTimezone,
  type NotificationJobDeps,
} from './notification-deliver.ts';

const {
  appearance,
  courtDayMarker,
  hearing,
  listing,
  listSnapshot,
  matter,
  member,
  notificationSetting,
  obligation,
  organization,
  proceeding,
  reminderDispatch,
  user,
} = schema;

export type ReminderKind = 'evening' | 'morning' | 'outcome_missing';
export type ReminderJobName = 'reminder.evening' | 'reminder.morning' | 'reminder.outcome-missing';

const KINDS = {
  evening: { job: 'reminder.evening', template: 'evening-brief', page: 'tomorrow' },
  morning: { job: 'reminder.morning', template: 'morning-diff', page: 'today?diff=1' },
  outcome_missing: { job: 'reminder.outcome-missing', template: 'outcome-missing', page: 'today' },
} as const satisfies Record<ReminderKind, { job: ReminderJobName; template: string; page: string }>;

export const reminderSchema = ReminderPayload;
export type ReminderJobPayload = z.output<typeof reminderSchema>;

const memberKey = (kind: ReminderKind) => (p: ReminderJobPayload) =>
  `reminder:${kind}:${p.memberId}:${p.date}`;

/** The `YYYY-MM-DD` of `now` in `timeZone`. */
export function localDateOf(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const slotOf = (minutes: number): string => {
  const floored = Math.floor(minutes / 30) * 30;
  return `${String(Math.floor(floored / 60)).padStart(2, '0')}:${String(floored % 60).padStart(2, '0')}`;
};

// --- scheduler -------------------------------------------------------------------------------

export interface ReminderTarget {
  kind: ReminderKind;
  payload: ReminderJobPayload;
}

export interface ReminderScheduleDeps {
  now?: () => Date;
  enqueue?: (target: ReminderTarget) => Promise<unknown>;
}

async function enqueueMember({ kind, payload }: ReminderTarget): Promise<unknown> {
  const data = reminderSchema.parse(payload);
  const sender = await getProducer();
  return sender.send(KINDS[kind].job, data, {
    singletonKey: memberKey(kind)(data),
    group: { id: data.workspaceId },
  });
}

/** The reminders due for a member at local `minutes` on `localDate`, from their preferences. */
export function dueReminders(prefs: ReminderPreferences, minutes: number): ReminderKind[] {
  const slot = slotOf(minutes);
  const due: ReminderKind[] = [];
  if (prefs.evening.enabled && prefs.evening.time === slot) due.push('evening');
  if (prefs.morning.enabled && prefs.morning.time === slot) due.push('morning');
  if (prefs.outcome_missing.enabled && minutes >= 12 * 60) due.push('outcome_missing');
  return due;
}

/** Enqueue the member reminders due now in every live workspace. */
export async function runReminderSchedule(
  ctx: Pick<JobContext, 'db' | 'log'>,
  deps: ReminderScheduleDeps = {},
): Promise<ReminderTarget[]> {
  const now = deps.now?.() ?? new Date();
  const send = deps.enqueue ?? enqueueMember;
  const rows = await ctx.db.execute<{ workspace_id: string; timezone: string }>(
    sql`select workspace_id::text, timezone from app_notification_digest_targets()`,
  );
  const enqueued: ReminderTarget[] = [];
  for (const row of rows) {
    const workspaceId = row.workspace_id;
    const today = localDateOf(now, row.timezone);
    const minutes = localMinutes(now, row.timezone);
    // Tenant tables are FORCE RLS: read the members and their preferences inside the workspace scope.
    const members = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
      const rows = await tx
        .select({ id: member.id, userId: member.userId })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(
          and(
            eq(member.organizationId, workspaceId),
            eq(member.status, 'active'),
            isNull(organization.deletedAt),
          ),
        );
      return Promise.all(
        rows.map(async (m) => ({
          ...m,
          prefs: await getReminderPreferences({ db: tx, workspaceId }, { userId: m.userId }),
        })),
      );
    });
    for (const m of members) {
      const { prefs } = m;
      for (const kind of dueReminders(prefs, minutes)) {
        const date = kind === 'evening' ? addDays(today, 1) : today;
        const target = { kind, payload: { workspaceId, memberId: m.id, date } };
        await send(target);
        enqueued.push(target);
      }
    }
  }
  ctx.log.info({ workspaces: rows.length, enqueued: enqueued.length }, 'reminders scheduled');
  return enqueued;
}

export const reminderSchedule = defineJob({
  name: 'system.reminder.schedule',
  schema: z.object({ workspaceId: z.null().optional() }),
  concurrency: 1,
  singleton: { key: () => 'reminder-schedule', policy: 'stately' },
  // Every half hour from 07:00 to 23:30 in Asia/Kolkata: the morning job, the evening slots
  // (18:00-23:00, freeze-safe) and the outcome-missing check.
  schedule: { cron: '0,30 7-23 * * *', payload: {} },
  handler: async (ctx) => {
    await runReminderSchedule(ctx);
  },
});

// --- content ---------------------------------------------------------------------------------

type Content =
  | { kind: 'evening'; counts: ReturnType<typeof eveningPushPayload>; names: string[] }
  | { kind: 'morning'; counts: { added: number; moved: number; removed: number } }
  | { kind: 'outcome_missing'; counts: { count: number } };

interface Recipient {
  userId: string;
  email: string;
  locale: string;
  slug: string;
}

async function loadReadiness(
  ctx: JobContext,
  workspaceId: string,
  userId: string,
  listingIds: string[],
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  for (const id of listingIds) {
    try {
      const brief = await assembleBrief({ db: ctx.db }, { workspaceId, userId }, id, {
        compress: false,
      });
      scores.set(id, computeReadiness(brief).score);
    } catch {
      // A brief that cannot be built counts as ready: the reminder never fails on it.
    }
  }
  return scores;
}

async function buildEvening(
  ctx: JobContext,
  { workspaceId, memberId, date }: ReminderJobPayload,
  who: Recipient,
): Promise<Content | null> {
  const day = await getCourtDay({ db: ctx.db }, { workspaceId, userId: who.userId }, { date });
  const ids = day.complexes.flatMap((c) =>
    c.halls.flatMap((h) => h.lists.flatMap((l) => l.items.map((i) => i.listingId))),
  );
  if (ids.length === 0) return null;
  const readiness = await loadReadiness(ctx, workspaceId, who.userId, ids);
  const obligationsDue = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(obligation)
      .where(
        and(
          eq(obligation.workspaceId, workspaceId),
          eq(obligation.ownerMemberId, memberId),
          eq(obligation.status, 'open'),
          eq(obligation.dueDate, date),
        ),
      );
    return row?.n ?? 0;
  });
  const brief = buildEveningBrief({ day, readiness, obligationsDue });
  return brief === null
    ? null
    : { kind: 'evening', counts: eveningPushPayload(brief), names: brief.names };
}

async function buildMorning(
  ctx: JobContext,
  { workspaceId, date }: ReminderJobPayload,
): Promise<Content | null> {
  const rows = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
    tx
      .select({
        forumId: listSnapshot.forumId,
        listType: listSnapshot.listType,
        rows: listSnapshot.rows,
      })
      .from(listSnapshot)
      .where(and(eq(listSnapshot.workspaceId, workspaceId), eq(listSnapshot.listDate, date)))
      .orderBy(asc(listSnapshot.createdAt), asc(listSnapshot.id)),
  );
  const byForum = new Map<string, typeof rows>();
  for (const r of rows) byForum.set(r.forumId, [...(byForum.get(r.forumId) ?? []), r]);
  const diffs: ListDiff[] = [];
  for (const history of byForum.values()) {
    const next = history.at(-1);
    const prev = history.at(-2);
    if (next === undefined || prev === undefined) continue;
    diffs.push(
      diffLists(
        { rows: prev.rows, listType: prev.listType },
        { rows: next.rows, listType: next.listType },
      ),
    );
  }
  const diff = buildMorningDiff(diffs);
  return diff === null ? null : { kind: 'morning', counts: diff };
}

async function buildOutcomes(
  ctx: JobContext,
  { workspaceId, memberId, date }: ReminderJobPayload,
  now: Date,
  timeZone: string,
  delayMinutes: number,
): Promise<Content | null> {
  const { start } = localDayBounds(date, timeZone);
  const { hearings, lastItemAt } = await withWorkspace(ctx.db, { workspaceId }, async (tx) => {
    const rows = await tx
      .select({
        hearingId: hearing.id,
        listingId: listing.id,
        hallId: listing.hallId,
        outcome: hearing.outcome,
        ownerMemberId: matter.ownerMemberId,
      })
      .from(hearing)
      .innerJoin(
        listing,
        and(eq(listing.workspaceId, hearing.workspaceId), eq(listing.id, hearing.listingId)),
      )
      .innerJoin(
        proceeding,
        and(
          eq(proceeding.workspaceId, listing.workspaceId),
          eq(proceeding.id, listing.proceedingId),
        ),
      )
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, proceeding.workspaceId), eq(matter.id, proceeding.matterId)),
      )
      .where(and(eq(hearing.workspaceId, workspaceId), eq(listing.listDate, date)));
    const ids = rows.map((r) => r.hearingId);
    const apps =
      ids.length === 0
        ? []
        : await tx
            .select({
              hearingId: appearance.hearingId,
              memberId: appearance.memberId,
              capacity: appearance.capacity,
            })
            .from(appearance)
            .where(
              and(eq(appearance.workspaceId, workspaceId), inArray(appearance.hearingId, ids)),
            );
    const markers = await tx
      .select({ hallId: courtDayMarker.hallId, setAt: courtDayMarker.setAt })
      .from(courtDayMarker)
      .where(and(eq(courtDayMarker.workspaceId, workspaceId), eq(courtDayMarker.listDate, date)));
    const list: HearingForOutcome[] = rows.map((r) => ({
      hearingId: r.hearingId,
      listingId: r.listingId,
      hallId: r.hallId,
      outcome: r.outcome,
      matterOwnerMemberId: r.ownerMemberId,
      appearances: apps
        .filter((a) => a.hearingId === r.hearingId)
        .map((a) => ({ memberId: a.memberId, capacity: a.capacity })),
    }));
    return { hearings: list, lastItemAt: new Map(markers.map((m) => [m.hallId, m.setAt])) };
  });
  const missing = findMissingOutcomes({
    hearings,
    lastItemAt,
    dayStart: start,
    now,
    delayMinutes,
  }).filter((m) => m.memberIds.includes(memberId));
  return missing.length === 0
    ? null
    : { kind: 'outcome_missing', counts: { count: missing.length } };
}

// --- per member ------------------------------------------------------------------------------

export type ReminderOutcome =
  'sent' | 'skippedEmpty' | 'skippedDisabled' | 'skippedNotMember' | 'alreadySent';

type Channel = 'in_app' | 'push' | 'email';

/** Build and deliver one member's reminder of `kind`. Exported for tests. */
export async function runReminder(
  ctx: JobContext,
  kind: ReminderKind,
  payload: ReminderJobPayload,
  deps: NotificationJobDeps = notificationJobDeps(ctx.log),
): Promise<ReminderOutcome> {
  const { workspaceId, memberId, date } = payload;
  const [row] = await ctx.db
    .select({
      userId: member.userId,
      email: user.email,
      locale: user.locale,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(
      and(
        eq(member.organizationId, workspaceId),
        eq(member.id, memberId),
        eq(member.status, 'active'),
        isNull(organization.deletedAt),
      ),
    );
  if (row === undefined) return 'skippedNotMember';
  const who: Recipient = row;

  const notificationCtx = { db: ctx.db, workspaceId };
  const prefs = await getReminderPreferences(notificationCtx, { userId: who.userId });
  const kindPrefs = prefs[kind];
  if (!kindPrefs.enabled) return 'skippedDisabled';
  // Email goes first: the handler runs in one workspace transaction, so a failure rolls back every
  // claim; failing before anything else went out means the retry cannot send a channel twice.
  const channels = (['email', 'push', 'in_app'] as const).filter((c) => kindPrefs.channels[c]);

  const now = deps.now?.() ?? new Date();
  const timeZone = await workspaceTimezone(ctx, workspaceId);
  const content =
    kind === 'evening'
      ? await buildEvening(ctx, payload, who)
      : kind === 'morning'
        ? await buildMorning(ctx, payload)
        : await buildOutcomes(ctx, payload, now, timeZone, prefs.outcome_missing.delayMinutes);
  if (content === null) return 'skippedEmpty';

  const { template, page } = KINDS[kind];
  const href = `/w/${who.slug}/${page}`;
  const url = appLink(deps.appUrl, href);
  const locale = toEmailLocale(who.locale);
  const category = `reminder.${kind}` as const;
  const [setting] = await ctx.db
    .select({ courtHoursQuiet: notificationSetting.courtHoursQuiet })
    .from(notificationSetting)
    .where(
      and(
        eq(notificationSetting.workspaceId, workspaceId),
        eq(notificationSetting.userId, who.userId),
      ),
    );

  // A demo workspace sends nothing outside it (#93): only the in-app row is written.
  const demo = await isDemoWorkspace(ctx.db, workspaceId);
  const sendOn = async (channel: Channel): Promise<void> => {
    if (demo && channel !== 'in_app') return;
    const t = await getTranslator(locale);
    if (channel === 'in_app') {
      const body =
        content.kind === 'evening'
          ? [
              t('reminders.inApp.eveningBody', content.counts),
              t('reminders.inApp.eveningNames', { names: content.names.join(', ') }),
            ].join(' ')
          : content.kind === 'morning'
            ? t('reminders.inApp.morningBody', content.counts)
            : t('reminders.inApp.outcomeBody', content.counts);
      const title = t(
        `reminders.email.${kind === 'outcome_missing' ? 'outcomeMissing' : kind}.subject`,
      );
      await notify(
        { ...notificationCtx, enqueueDelivery: () => Promise.resolve(undefined) },
        { userId: who.userId, category, title, body, href, dedupeKey: `reminder:${kind}:${date}` },
      );
    } else if (channel === 'push') {
      const push = deps.push;
      if (push === undefined) return;
      if (isQuietTime(localMinutes(now, timeZone), setting)) return;
      // Generic title and a link only: `showDetails` stays off, so no count or name is shown.
      await push.send(
        {
          notificationId: randomUUID(),
          userId: who.userId,
          category,
          title: '',
          body: null,
          href: url,
          showDetails: false,
        },
        ctx.db,
      );
    } else {
      if (await isSuppressed(ctx.db, who.email)) return;
      const email = await renderEmail(
        template,
        { ...content.counts, url, preferencesUrl: preferencesUrl(deps.appUrl) },
        locale,
      );
      try {
        await deps.email.send({ to: who.email, ...email, tags: { template } });
      } catch (error) {
        if (isPermanentEmailError(error)) {
          ctx.log.warn({ workspaceId, code: emailErrorCode(error) }, 'reminder email rejected');
          return;
        }
        throw error;
      }
    }
  };

  let sent = 0;
  for (const channel of channels) {
    const claimed = await withWorkspace(ctx.db, { workspaceId }, (tx) =>
      tx
        .insert(reminderDispatch)
        .values({ workspaceId, memberId, kind, forDate: date, channel })
        .onConflictDoNothing()
        .returning({ id: reminderDispatch.id }),
    );
    const claim = claimed[0];
    if (claim === undefined) continue;
    try {
      await sendOn(channel);
      sent += 1;
    } catch (error) {
      // Release the claim so the retry sends this channel again, and only this one.
      await withWorkspace(ctx.db, { workspaceId }, (tx) =>
        tx.delete(reminderDispatch).where(eq(reminderDispatch.id, claim.id)),
      );
      const code = emailErrorCode(error);
      ctx.log.warn({ workspaceId, kind, channel, code }, 'reminder send failed');
      throw new RetryableError(
        'REMINDER_RETRY',
        `reminder ${channel} failed (${code}); will retry`,
      );
    }
  }
  return sent === 0 ? 'alreadySent' : 'sent';
}

function reminderJob(kind: ReminderKind) {
  return defineJob({
    name: KINDS[kind].job,
    schema: reminderSchema,
    concurrency: 4,
    retry: { limit: 3, delaySec: 60, backoff: true, delayMaxSec: 1800 },
    singleton: { key: memberKey(kind) },
    idempotencyKey: memberKey(kind),
    handler: async (ctx, payload) => {
      const outcome = await runReminder(ctx, kind, payload);
      ctx.log.info({ workspaceId: payload.workspaceId, kind, outcome }, 'reminder done');
    },
  });
}

export const reminderEvening = reminderJob('evening');
export const reminderMorning = reminderJob('morning');
export const reminderOutcomeMissing = reminderJob('outcome_missing');
