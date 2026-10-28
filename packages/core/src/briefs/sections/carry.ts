// The carry section (#60): the union of (a) documents linked to open obligations, (b) the workspace's
// M2 always-carry rules (an empty provider until memory is wired) and (c) the manual items kept in
// `brief_state`. The stored edits (a tick, the removal of a derived item) survive re-assembly. A
// reserved entry records that the lawyer reviewed the list.
import { schema } from '@causedeck/db';
import type { BriefState, CarryItem } from '@causedeck/validators';

type BriefCarryEntry = BriefState['carry'][number];
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import type { BriefScope, ListingContext, MemoryProvider, MemoryQuery } from '../scope.ts';
import { shortDate } from './obligations.ts';

/** The reserved `brief_state.carry` entry that marks the list as reviewed. */
export const CARRY_REVIEWED_KEY = '__reviewed__';

export interface CarryResult {
  items: CarryItem[];
  reviewed: boolean;
}

export async function carrySection(
  scope: BriefScope,
  listing: ListingContext,
  documentIds: string[],
  state: BriefState,
  memory: MemoryProvider,
  query: MemoryQuery,
): Promise<CarryResult> {
  const { tx, actor } = scope;
  const edits = new Map<string, BriefCarryEntry>(state.carry.map((e) => [e.key, e]));
  const derived: CarryItem[] = [];

  if (documentIds.length > 0) {
    const orders = await tx
      .select({ documentId: schema.order.documentId, orderDate: schema.order.orderDate })
      .from(schema.order)
      .where(
        and(
          eq(schema.order.workspaceId, actor.workspaceId),
          inArray(schema.order.documentId, documentIds),
        ),
      );
    const dates = new Map(orders.map((o) => [o.documentId, o.orderDate]));
    for (const documentId of documentIds) {
      const date = dates.get(documentId);
      derived.push({
        key: `doc:${documentId}`,
        kind: 'document',
        label: date === undefined ? 'Document' : `Order of ${shortDate(date)}`,
        document_id: documentId,
        ticked: false,
      });
    }
  }
  const rules = await memory.alwaysCarry({
    workspaceId: actor.workspaceId,
    userId: query.userId,
    matterId: listing.matterId,
    listingId: listing.listingId,
    firstHearing: await isFirstHearing(scope, listing),
  });
  for (const rule of rules) {
    // A removed suggestion is a signal the lawyer can later be asked about (3 removals: a proposal).
    if (edits.get(`rule:${rule.id}`)?.removed) await memory.observeCarryRemoval?.(query, rule);
    derived.push({
      key: `rule:${rule.id}`,
      kind: 'rule',
      label: rule.label,
      document_id: null,
      ticked: false,
    });
  }

  const items: CarryItem[] = [];
  for (const item of derived) {
    const edit = edits.get(item.key);
    if (edit?.removed) continue;
    items.push({ ...item, ticked: edit?.ticked ?? false });
  }
  for (const entry of state.carry) {
    if (!entry.manual || entry.removed || entry.label === null) continue;
    items.push({
      key: entry.key,
      kind: 'manual',
      label: entry.label,
      document_id: null,
      ticked: entry.ticked,
    });
  }
  return { items, reviewed: edits.get(CARRY_REVIEWED_KEY)?.ticked === true };
}

/** No earlier listing of the proceeding: the first hearing, when 'first_hearing' rules apply. */
async function isFirstHearing(scope: BriefScope, listing: ListingContext): Promise<boolean> {
  const [earlier] = await scope.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.listing)
    .where(
      and(
        eq(schema.listing.workspaceId, scope.actor.workspaceId),
        eq(schema.listing.proceedingId, listing.proceedingId),
        lt(schema.listing.listDate, listing.listDate),
      ),
    );
  return (earlier?.n ?? 0) === 0;
}
