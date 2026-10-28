// Obligation reminders (#67): once a day per member, an in-app notice when obligations they own
// are due within the lead time or overdue. Counts and a link only, never a description. Delivery
// goes through `notify` (#23); the dedupe key makes a second run on the same local day a no-op.
// Only open obligations on matters the member may read are counted. Nothing here closes,
// reschedules or files anything.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { notify } from '@causedeck/notifications';
import { and, eq, lte, sql } from 'drizzle-orm';

import { addDays, localDay } from './due.ts';

const { obligation, matter, matterRestriction, member } = schema;

/** Days ahead of the due date a reminder starts; the workspace has no per-member setting yet. */
export const DEFAULT_REMINDER_LEAD_DAYS = 2;

export interface ReminderDeps {
  db: Database | Transaction;
  now?: () => Date;
  timeZone?: string;
  leadDays?: number;
}

export interface ReminderSummary {
  /** Members who got a notice in this run. */
  notified: number;
  /** Members with something due but already reminded today. */
  alreadyReminded: number;
}

/** Send today's reminders for one workspace. Idempotent per member and local day. */
export async function sendObligationReminders(
  deps: ReminderDeps,
  workspaceId: string,
): Promise<ReminderSummary> {
  return withWorkspace(deps.db, { workspaceId }, (tx) => remindIn(tx, deps, workspaceId));
}

async function remindIn(
  db: Transaction,
  deps: ReminderDeps,
  workspaceId: string,
): Promise<ReminderSummary> {
  const today = localDay(deps.now?.() ?? new Date(), deps.timeZone);
  const horizon = addDays(today, deps.leadDays ?? DEFAULT_REMINDER_LEAD_DAYS);
  const rows = await db
    .select({
      userId: member.userId,
      overdue: sql<number>`count(*) filter (where ${obligation.dueDate} < ${today})::int`,
      soon: sql<number>`count(*) filter (where ${obligation.dueDate} >= ${today})::int`,
    })
    .from(obligation)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, obligation.workspaceId),
        eq(member.id, obligation.ownerMemberId),
      ),
    )
    .innerJoin(
      matter,
      and(eq(matter.workspaceId, obligation.workspaceId), eq(matter.id, obligation.matterId)),
    )
    .leftJoin(
      matterRestriction,
      and(
        eq(matterRestriction.workspaceId, matter.workspaceId),
        eq(matterRestriction.matterId, matter.id),
      ),
    )
    .where(
      and(
        eq(obligation.workspaceId, workspaceId),
        eq(obligation.status, 'open'),
        eq(member.status, 'active'),
        lte(obligation.dueDate, horizon),
        sql`(${matterRestriction.matterId} is null or ${member.userId}::uuid = any(${matterRestriction.allowedUserIds}))`,
      ),
    )
    .groupBy(member.userId);
  const summary: ReminderSummary = { notified: 0, alreadyReminded: 0 };
  for (const row of rows) {
    const total = row.overdue + row.soon;
    if (total === 0) continue;
    const before = await countReminders(db, workspaceId, row.userId, `obl:${today}`);
    await notify(
      // In-app only: the notice is the delivery, so no email or push is queued.
      { db, workspaceId, enqueueDelivery: () => Promise.resolve(undefined) },
      {
        userId: row.userId,
        category: 'system.notice',
        title: 'Obligations need attention',
        body: `${String(row.overdue)} overdue, ${String(row.soon)} due within ${String(deps.leadDays ?? DEFAULT_REMINDER_LEAD_DAYS)} days.`,
        href: '/obligations',
        dedupeKey: `obl:${today}`,
      },
    );
    const after = await countReminders(db, workspaceId, row.userId, `obl:${today}`);
    if (after > before) summary.notified += 1;
    else summary.alreadyReminded += 1;
  }
  return summary;
}

async function countReminders(
  db: Database | Transaction,
  workspaceId: string,
  userId: string,
  dedupeKey: string,
): Promise<number> {
  const { notification } = schema;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(
      and(
        eq(notification.workspaceId, workspaceId),
        eq(notification.userId, userId),
        eq(notification.dedupeKey, dedupeKey),
      ),
    );
  return row?.n ?? 0;
}
