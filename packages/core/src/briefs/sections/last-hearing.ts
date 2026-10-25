// The last-hearing section (#60): one line from the latest hearing on the proceeding up to today,
// else from the memory port's summary (the caller passes it only when `memory.read` allows).
import { schema } from '@causedeck/db';
import { hasProvenance, type BriefLine } from '@causedeck/validators';
import { and, desc, eq, lte } from 'drizzle-orm';

import {
  provenanceOf,
  toBriefLine,
  type BriefScope,
  type ListingContext,
  type MemoryLine,
} from '../assemble.ts';
import { istDay, shortDate } from './obligations.ts';

export async function lastHearingSection(
  scope: BriefScope,
  listing: ListingContext,
  fromMemory: MemoryLine | null,
): Promise<BriefLine | null> {
  const { tx, actor } = scope;
  const [row] = await tx
    .select({ hearing: schema.hearing })
    .from(schema.hearing)
    .innerJoin(
      schema.listing,
      and(
        eq(schema.listing.workspaceId, schema.hearing.workspaceId),
        eq(schema.listing.id, schema.hearing.listingId),
      ),
    )
    .where(
      and(
        eq(schema.hearing.workspaceId, actor.workspaceId),
        eq(schema.listing.proceedingId, listing.proceedingId),
        lte(schema.hearing.heldOn, istDay(scope.now)),
      ),
    )
    .orderBy(desc(schema.hearing.heldOn), desc(schema.hearing.createdAt))
    .limit(1);
  if (row !== undefined) {
    const h = row.hearing;
    const parts = [
      `Heard ${shortDate(h.heldOn)}`,
      h.outcome,
      h.adjournmentReason === null ? null : `adjourned: ${h.adjournmentReason}`,
      h.nextDateConfirmed ?? h.nextDateProposed
        ? `next ${shortDate((h.nextDateConfirmed ?? h.nextDateProposed) as string)}`
        : null,
    ].filter((p): p is string => p !== null);
    const line: BriefLine = {
      text: parts.join('; '),
      label: h.confirmationState === 'proposed' ? 'Unconfirmed' : null,
      page_no: null,
      quote: null,
      ...provenanceOf(h),
    };
    if (hasProvenance(line)) return line;
  }
  if (fromMemory === null) return null;
  const line = toBriefLine(fromMemory);
  return hasProvenance(line) ? line : null;
}
