// `order_record` (#47): an order of a proceeding, with its operative directions (each cites an
// anchor) and the next date it states. Always a proposal. Recording an order never changes the
// proceeding's canonical next date: that is `next_date`'s, and only after a person accepts.
// Undo deletes the order, which the database refuses while an obligation cites it.
import { schema } from '@causedeck/db';
import { ORDER_TYPES } from '@causedeck/validators/matter-graph';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { conflict } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { day, parsePayload, pgCode, provenanceValues, uuid } from './common.ts';

const Payload = z.strictObject({
  proceedingId: uuid,
  documentId: uuid,
  orderDate: day,
  orderType: z.enum(ORDER_TYPES),
  benchId: uuid.nullable().optional(),
  neutralCitation: z.string().trim().min(1).nullable().optional(),
  operativeDirections: z
    .array(z.strictObject({ text: z.string().trim().min(1), anchorId: uuid }))
    .max(100)
    .default([]),
  nextDate: day.nullable().optional(),
});
type Payload = z.output<typeof Payload>;

export const orderRecordHandler: ProposalHandler<Payload> = {
  kind: 'order_record',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const { order } = schema;
    const [row] = await scope.tx
      .insert(order)
      .values({
        workspaceId: scope.actor.workspaceId,
        proceedingId: ctx.payload.proceedingId,
        documentId: ctx.payload.documentId,
        orderDate: ctx.payload.orderDate,
        orderType: ctx.payload.orderType,
        benchId: ctx.payload.benchId ?? null,
        neutralCitation: ctx.payload.neutralCitation ?? null,
        operativeDirections: ctx.payload.operativeDirections,
        nextDate: ctx.payload.nextDate ?? null,
        ...provenanceValues(ctx.provenance),
      })
      .returning({ id: order.id });
    if (!row) throw new Error('order handler: insert returned no row');
    return {
      undoPayload: { orderId: row.id },
      entityRefs: {
        orderIds: [row.id],
        proceedingId: ctx.payload.proceedingId,
        documentIds: [ctx.payload.documentId],
      },
      summary: 'Recorded an order',
      proceedingId: ctx.payload.proceedingId,
    };
  },

  async undo(scope, activity) {
    const { order } = schema;
    const orderId = activity.undoPayload?.['orderId'];
    if (typeof orderId !== 'string') throw conflict('The order id is missing');
    try {
      await scope.tx.transaction((sp) =>
        sp
          .delete(order)
          .where(and(eq(order.workspaceId, activity.workspaceId), eq(order.id, orderId))),
      );
    } catch (error) {
      if (pgCode(error) === '23503') {
        throw conflict('An obligation cites this order now; remove it first');
      }
      throw error;
    }
  },
};
