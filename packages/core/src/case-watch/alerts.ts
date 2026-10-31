// Change alerts for a watched case status (#592, D-048): after a lookup stores a changed snapshot,
// the advocate who owns the watch is told about a new next date, a new order or a stage change, one
// notification per kind. The first snapshot of a watch never alerts (every field is new then), a
// sensitive matter never alerts, and titles carry no party names or order text. A repeated snapshot
// is a no-op through the notification `dedupeKey`.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import { notify, type CategoryKey, type DeliveryJob } from '@causedeck/notifications';
import { and, eq } from 'drizzle-orm';

import type { GraphActor } from '../matter-graph/index.ts';

import type { StatusChanges } from './diff.ts';

const { matter, organization } = schema;

type Db = Database | Transaction;

export interface StatusAlertDeps {
  db: Db;
  /** `NotifyContext.enqueueDelivery`: sends one `notification.deliver` job. */
  enqueueDelivery: (job: DeliveryJob) => Promise<unknown>;
}

export interface StatusAlertInput {
  snapshotId: string;
  matterId: string;
  changes: StatusChanges;
  /** The snapshot is the watch's first: nothing to alert on. */
  firstSnapshot: boolean;
  /** A line appended to the new-order alert (#506: the free tier's upgrade prompt); never blocks it. */
  orderNote?: string;
}

type AlertKind = 'next_date' | 'order' | 'stage';

const ALERTS: Record<AlertKind, { category: CategoryKey; title: string; body: string }> = {
  next_date: {
    category: 'status.next_date',
    title: 'Next hearing date changed',
    body: 'The court status page shows a new next hearing date. Review the proposal to update your matter.',
  },
  order: {
    category: 'status.order',
    title: 'New order on the court status page',
    body: 'A new order is listed for one of your watched cases.',
  },
  stage: {
    category: 'status.stage',
    title: 'Case stage changed',
    body: 'The court status page shows a new stage for one of your watched cases.',
  },
};

/** The kinds of change in `changes`, in alert order. */
function changedKinds(changes: StatusChanges): AlertKind[] {
  const kinds: AlertKind[] = [];
  if (changes.nextHearingDate !== null) kinds.push('next_date');
  if (changes.newOrders.length > 0) kinds.push('order');
  if (changes.stage !== null) kinds.push('stage');
  return kinds;
}

/**
 * Alert the advocate (the actor, who owns the watch) of what changed. Returns the number of
 * notifications sent; a failing notification is skipped and never fails the lookup.
 */
export async function notifyStatusChanges(
  deps: StatusAlertDeps,
  actor: GraphActor,
  input: StatusAlertInput,
): Promise<number> {
  if (input.firstSnapshot) return 0;
  const kinds = changedKinds(input.changes);
  if (kinds.length === 0) return 0;
  const target = await withWorkspace(deps.db, actor, async (tx) => {
    const [row] = await tx
      .select({ sensitive: matter.sensitive, slug: organization.slug })
      .from(matter)
      .innerJoin(organization, eq(organization.id, matter.workspaceId))
      .where(and(eq(matter.workspaceId, actor.workspaceId), eq(matter.id, input.matterId)));
    return row;
  });
  if (target === undefined || target.sensitive) return 0;
  const ctx = {
    db: deps.db,
    workspaceId: actor.workspaceId,
    enqueueDelivery: deps.enqueueDelivery,
  };
  let sent = 0;
  for (const kind of kinds) {
    const alert = ALERTS[kind];
    try {
      await notify(ctx, {
        userId: actor.userId,
        category: alert.category,
        title: alert.title,
        body: kind === 'order' && input.orderNote ? `${alert.body} ${input.orderNote}` : alert.body,
        href: `/w/${target.slug}/matters/${input.matterId}`,
        dedupeKey: `status:${input.snapshotId}:${kind}`,
      });
      sent += 1;
    } catch {
      // One failed notification (e.g. a delivery enqueue error) must not stop the others.
    }
  }
  return sent;
}
