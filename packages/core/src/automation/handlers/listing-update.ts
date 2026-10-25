// `listing_update` (#47): item number, courtroom (hall) and bench of an existing listing, read from
// a cause list. The date and the canonical flag are not here: they change only through
// `next_date` and `confirmNextDate` (ADR 0016), and the strict payload has no key for them.
import { schema } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { conflict, notFound } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { parsePayload, uuid } from './common.ts';

const Payload = z
  .strictObject({
    listingId: uuid,
    itemNo: z.string().trim().min(1).nullable().optional(),
    hallId: uuid.nullable().optional(),
    benchId: uuid.nullable().optional(),
  })
  .refine((p) => p.itemNo !== undefined || p.hallId !== undefined || p.benchId !== undefined, {
    message: 'Give at least one of itemNo, hallId and benchId',
  });
type Payload = z.output<typeof Payload>;

interface Fields {
  itemNo: string | null;
  hallId: string | null;
  benchId: string | null;
}

export const listingUpdateHandler: ProposalHandler<Payload> = {
  kind: 'listing_update',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const { listing } = schema;
    const { workspaceId } = scope.actor;
    const [row] = await scope.tx
      .select()
      .from(listing)
      .where(and(eq(listing.workspaceId, workspaceId), eq(listing.id, ctx.payload.listingId)))
      .limit(1)
      .for('update');
    if (row === undefined) throw notFound('Listing not found');
    const before: Fields = { itemNo: row.itemNo, hallId: row.hallId, benchId: row.benchId };
    const after: Fields = {
      itemNo: ctx.payload.itemNo === undefined ? before.itemNo : ctx.payload.itemNo,
      hallId: ctx.payload.hallId === undefined ? before.hallId : ctx.payload.hallId,
      benchId: ctx.payload.benchId === undefined ? before.benchId : ctx.payload.benchId,
    };
    await scope.tx
      .update(listing)
      .set({ ...after, updatedAt: scope.now() })
      .where(and(eq(listing.workspaceId, workspaceId), eq(listing.id, row.id)));
    return {
      undoPayload: { listingId: row.id, before, after },
      entityRefs: { listingId: row.id, proceedingId: row.proceedingId },
      summary: 'Updated a listing from the cause list',
      proceedingId: row.proceedingId,
    };
  },

  async undo(scope, activity) {
    const { listing } = schema;
    const payload = activity.undoPayload as { listingId?: string; before?: Fields } | null;
    if (payload?.listingId === undefined || payload.before === undefined) {
      throw conflict('The listing to restore is missing');
    }
    await scope.tx
      .update(listing)
      .set({ ...payload.before, updatedAt: scope.now() })
      .where(and(eq(listing.workspaceId, activity.workspaceId), eq(listing.id, payload.listingId)));
  },
};
