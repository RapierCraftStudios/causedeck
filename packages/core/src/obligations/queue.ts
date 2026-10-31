// `queryQueue` and `missedObligations` (#67). The queue lists open obligations in five groups
// (overdue, today, this week, later, undated), one query per group, filterable by matter, owner,
// kind (the obligation's `source`) and source type. Overdue sort first by age (oldest due date
// first). Only obligations of matters the actor may read appear. A miss is an obligation whose
// current due date passed with the obligation still open (or closed after it); a deliberate
// reschedule moves the date, is counted apart and is not a miss.
import { can } from '@causedeck/auth/policy';
import { schema } from '@causedeck/db';
import {
  MissedQuery,
  QUEUE_GROUPS,
  QueueQuery,
  type QueueGroup,
} from '@causedeck/validators/obligation';
import { and, asc, count, eq, gt, gte, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm';

import { localDay, weekEnd } from './due.ts';
import {
  inObligationScope,
  readableObligation,
  parseObligationInput,
  readObligations,
  visibleMatters,
  visibleRow,
  type ObligationActor,
  type ObligationDeps,
  type ObligationRow,
  type ObligationScope,
} from './context.ts';

const { obligation, obligationEvent, matter, matterRestriction, member } = schema;

export type QueueResult = Record<QueueGroup, ObligationRow[]>;

export async function queryQueue(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: QueueQuery = {},
): Promise<QueueResult> {
  const q = parseObligationInput(QueueQuery, input);
  return inObligationScope(deps, actor, async (scope) => {
    if (!roleCanRead(scope)) return emptyQueue();
    const today = localDay(scope.now);
    const ob = readableObligation(scope);
    const base: SQL[] = [
      eq(ob.workspaceId, scope.actor.workspaceId),
      eq(ob.status, 'open'),
      visibleMatters(scope),
    ];
    if (q.matterId !== undefined) base.push(eq(ob.matterId, q.matterId));
    if (q.ownerMemberId !== undefined) base.push(eq(ob.ownerMemberId, q.ownerMemberId));
    if (q.source !== undefined) base.push(eq(ob.source, q.source));
    if (q.sourceType !== undefined) base.push(eq(ob.sourceType, q.sourceType));
    const dueFilter: Record<QueueGroup, SQL> = {
      overdue: lt(ob.dueDate, today),
      today: eq(ob.dueDate, today),
      this_week: and(gt(ob.dueDate, today), lte(ob.dueDate, weekEnd(today))) as SQL,
      later: gt(ob.dueDate, weekEnd(today)),
      undated: isNull(ob.dueDate),
    };
    const out = emptyQueue();
    // A clerk reads the column-scoped view in a clerk-role scope: strategy descriptions come back NULL.
    await readObligations(scope, async (tx) => {
      for (const group of QUEUE_GROUPS) {
        const rows = await tx
          .select({ row: ob })
          .from(ob)
          .innerJoin(
            matter,
            and(eq(matter.workspaceId, ob.workspaceId), eq(matter.id, ob.matterId)),
          )
          .leftJoin(
            member,
            and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
          )
          .leftJoin(
            matterRestriction,
            and(
              eq(matterRestriction.workspaceId, matter.workspaceId),
              eq(matterRestriction.matterId, matter.id),
            ),
          )
          .where(and(...base, dueFilter[group]))
          .orderBy(asc(ob.dueDate), asc(ob.createdAt), asc(ob.id))
          .limit(q.limit);
        out[group] = rows.map((r) => visibleRow(r.row));
      }
    });
    return out;
  });
}

function roleCanRead(scope: ObligationScope): boolean {
  return can(scope.actor, 'obligation.read', undefined, scope.settings).allow;
}

const emptyQueue = (): QueueResult => ({
  overdue: [],
  today: [],
  this_week: [],
  later: [],
  undated: [],
});

export interface MissedReport {
  /** Obligations due in the range that were not closed by their current due date. */
  missed: number;
  /** Deliberate reschedules (with a reason) recorded in the range: not misses. */
  rescheduled: number;
}

export async function missedObligations(
  deps: ObligationDeps,
  actor: ObligationActor,
  input: MissedQuery,
): Promise<MissedReport> {
  const q = parseObligationInput(MissedQuery, input);
  return inObligationScope(deps, actor, async (scope) => {
    if (!roleCanRead(scope)) return { missed: 0, rescheduled: 0 };
    const today = localDay(scope.now);
    const [missed] = await scope.tx
      .select({ n: count() })
      .from(obligation)
      .innerJoin(
        matter,
        and(eq(matter.workspaceId, obligation.workspaceId), eq(matter.id, obligation.matterId)),
      )
      .leftJoin(
        member,
        and(eq(member.organizationId, matter.workspaceId), eq(member.id, matter.ownerMemberId)),
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
          eq(obligation.workspaceId, scope.actor.workspaceId),
          visibleMatters(scope),
          gte(obligation.dueDate, q.from),
          lte(obligation.dueDate, q.to),
          lt(obligation.dueDate, today),
          ne(obligation.status, 'superseded'),
          or(
            eq(obligation.status, 'open'),
            sql`(${obligation.closedAt} at time zone 'Asia/Kolkata')::date > ${obligation.dueDate}`,
          ),
        ),
      );
    const [moved] = await scope.tx
      .select({ n: count() })
      .from(obligationEvent)
      .where(
        and(
          eq(obligationEvent.workspaceId, scope.actor.workspaceId),
          eq(obligationEvent.kind, 'rescheduled'),
          gte(sql`(${obligationEvent.at} at time zone 'Asia/Kolkata')::date`, q.from),
          lte(sql`(${obligationEvent.at} at time zone 'Asia/Kolkata')::date`, q.to),
        ),
      );
    return { missed: missed?.n ?? 0, rescheduled: moved?.n ?? 0 };
  });
}
