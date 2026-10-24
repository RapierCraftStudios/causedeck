// Notice alerts (#587, D-048): a newly matched notice is told to every active member of the matched
// workspace who may read matters, once per member per notice, through `notify()` (category
// `notices`, so each member's channel and digest preferences decide where it goes). The
// notification `dedupeKey` makes a repeated poll or replay a no-op. The title is the public notice
// title; the body only counts the member's own matters before the forum, never names a party, and
// a matter the member may not read is not counted.
import { isRole } from '@causedeck/auth';
import { can, type Actor } from '@causedeck/auth/policy';
import { matterVisibilityPredicate } from '@causedeck/auth/policy/visibility';
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { notify, type DeliveryJob } from '@causedeck/notifications';
import { and, asc, eq, sql } from 'drizzle-orm';

import { getRoleSettings, toPolicySettings } from '../workspaces/index.ts';

import type { MatchedNotice } from './match.ts';

const { matter, member, notice, noticeMatch, organization } = schema;

export interface NoticeAlertDeps {
  db: Database | Transaction;
  /** `NotifyContext.enqueueDelivery`: sends one `notification.deliver` job. */
  enqueueDelivery: (job: DeliveryJob) => Promise<unknown>;
}

/** The longest notice title carried into a notification. */
const TITLE_MAX = 200;

const matterOwnerUserId = sql`(select ${member.userId} from ${member} where ${member.organizationId} = ${matter.workspaceId} and ${member.id} = ${matter.ownerMemberId})`;

function bodyFor(matters: number): string {
  if (matters === 0) return 'The court published a notice for a forum your workspace uses.';
  return matters === 1
    ? 'The court published a notice for the forum of 1 of your matters.'
    : `The court published a notice for the forum of ${String(matters)} of your matters.`;
}

/**
 * Alert the members of each matched workspace. Returns the number of notifications sent; a failing
 * notification is skipped and never stops the others.
 */
export async function notifyNoticeMatches(
  deps: NoticeAlertDeps,
  matches: readonly MatchedNotice[],
): Promise<number> {
  let sent = 0;
  for (const { workspaceId, noticeId } of matches) {
    const audience = await withWorkspace(deps.db, { workspaceId }, async (tx) => {
      const [row] = await tx.select().from(notice).where(eq(notice.id, noticeId));
      const [org] = await tx
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, workspaceId));
      if (row === undefined || org === undefined) return undefined;
      const settings = toPolicySettings(await getRoleSettings(tx, workspaceId));
      const members = await tx
        .select({ userId: member.userId, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, workspaceId), eq(member.status, 'active')))
        .orderBy(asc(member.userId));
      const readers: { userId: string; matters: number }[] = [];
      for (const m of members) {
        if (!isRole(m.role)) continue;
        const reader: Actor = { userId: m.userId, workspaceId, role: m.role };
        if (!can(reader, 'matter.read', undefined, settings).allow) continue;
        const visible = await tx
          .select({ id: noticeMatch.id })
          .from(noticeMatch)
          .innerJoin(
            matter,
            and(
              eq(matter.workspaceId, noticeMatch.workspaceId),
              eq(matter.id, noticeMatch.matterId),
            ),
          )
          .where(
            and(
              eq(noticeMatch.workspaceId, workspaceId),
              eq(noticeMatch.noticeId, noticeId),
              matterVisibilityPredicate(reader, matter.id, {
                settings,
                ownerUserId: matterOwnerUserId,
              }),
            ),
          );
        readers.push({ userId: m.userId, matters: visible.length });
      }
      return { title: row.title, slug: org.slug, readers };
    });
    if (audience === undefined) continue;
    const ctx = { db: deps.db, workspaceId, enqueueDelivery: deps.enqueueDelivery };
    for (const reader of audience.readers) {
      try {
        await notify(ctx, {
          userId: reader.userId,
          category: 'notices',
          title: audience.title.slice(0, TITLE_MAX),
          body: bodyFor(reader.matters),
          href: `/w/${audience.slug}/courts`,
          dedupeKey: `notice:${noticeId}`,
        });
        sent += 1;
      } catch {
        // One member's failed notification (e.g. a delivery enqueue error) must not stop the others.
      }
    }
  }
  return sent;
}
