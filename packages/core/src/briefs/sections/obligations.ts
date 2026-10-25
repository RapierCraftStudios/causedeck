// The obligations section (#60): open obligations with owner, due date and status in the phrase
// pattern 'counter not yet filed; due 20 Oct'; overdue first, then by due date. Closed obligations
// are excluded and counted.
import { schema } from '@causedeck/db';
import { hasProvenance, type ObligationLine } from '@causedeck/validators';
import { and, count, eq, inArray, or, isNull } from 'drizzle-orm';

import { provenanceOf, type BriefScope, type ListingContext } from '../assemble.ts';

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-10-20` as `20 Oct`. */
export function shortDate(date: string): string {
  const [, m, d] = date.split('-');
  return `${Number(d)} ${MONTH_NAMES[Number(m) - 1] ?? ''}`;
}

/** The India-time calendar day of `now`. */
export function istDay(now: Date): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export interface ObligationsResult {
  open: ObligationLine[];
  closedCount: number;
  /** The documents of the orders that gave rise to the open obligations. */
  documentIds: string[];
}

export async function obligationsSection(
  scope: BriefScope,
  listing: ListingContext,
): Promise<ObligationsResult> {
  const { tx, actor } = scope;
  const mine = and(
    eq(schema.obligation.workspaceId, actor.workspaceId),
    eq(schema.obligation.matterId, listing.matterId),
    or(
      isNull(schema.obligation.proceedingId),
      eq(schema.obligation.proceedingId, listing.proceedingId),
    ),
  );
  const rows = await tx
    .select({ obligation: schema.obligation, documentId: schema.order.documentId })
    .from(schema.obligation)
    .leftJoin(
      schema.order,
      and(
        eq(schema.order.workspaceId, schema.obligation.workspaceId),
        eq(schema.order.id, schema.obligation.sourceOrderId),
      ),
    )
    .where(and(mine, eq(schema.obligation.status, 'open')));
  const [closed] = await tx
    .select({ n: count() })
    .from(schema.obligation)
    .where(and(mine, inArray(schema.obligation.status, ['done', 'not_applicable'])));

  const today = istDay(scope.now);
  const open: ObligationLine[] = [];
  for (const { obligation } of rows) {
    const line: ObligationLine = {
      obligation_id: obligation.id,
      text:
        obligation.dueDate === null
          ? obligation.description
          : `${obligation.description}; due ${shortDate(obligation.dueDate)}`,
      owner_member_id: obligation.ownerMemberId,
      due_date: obligation.dueDate,
      status: 'open',
      overdue: obligation.dueDate !== null && obligation.dueDate < today,
      ...provenanceOf(obligation),
    };
    if (hasProvenance(line)) open.push(line);
  }
  open.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      (a.due_date ?? '9999-12-31').localeCompare(b.due_date ?? '9999-12-31') ||
      a.text.localeCompare(b.text),
  );
  const kept = new Set(open.map((o) => o.obligation_id));
  const docs = rows
    .filter((r) => kept.has(r.obligation.id))
    .map((r) => ({ id: r.obligation.id, documentId: r.documentId }));
  return {
    open,
    closedCount: closed?.n ?? 0,
    documentIds: [...new Set(docs.map((d) => d.documentId).filter((d): d is string => d !== null))],
  };
}
