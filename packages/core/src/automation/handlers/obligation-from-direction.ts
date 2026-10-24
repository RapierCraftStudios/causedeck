// `obligation_from_direction` (#47): an obligation read from an order's operative direction, as a
// basic insert with provenance. Always a proposal (compliance dates are date-critical). It is
// inserted `open`: closing one needs a reason and a closer (`obligation_closure_chk` and the
// closure trigger, C01), which is a person's act and not this handler's.
import { schema } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { conflict } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { day, parsePayload, provenanceValues, uuid } from './common.ts';

const Payload = z.strictObject({
  matterId: uuid,
  proceedingId: uuid.nullable().optional(),
  description: z.string().trim().min(1).max(2000),
  dueDate: day.nullable().optional(),
  basis: z.string().trim().min(1).max(500).nullable().optional(),
  sourceOrderId: uuid.nullable().optional(),
  ownerMemberId: uuid.nullable().optional(),
});
type Payload = z.output<typeof Payload>;

export const obligationFromDirectionHandler: ProposalHandler<Payload> = {
  kind: 'obligation_from_direction',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const { obligation } = schema;
    const [row] = await scope.tx
      .insert(obligation)
      .values({
        workspaceId: scope.actor.workspaceId,
        matterId: ctx.payload.matterId,
        proceedingId: ctx.payload.proceedingId ?? null,
        source: 'order_direction',
        description: ctx.payload.description,
        dueDate: ctx.payload.dueDate ?? null,
        basis: ctx.payload.basis ?? null,
        sourceOrderId: ctx.payload.sourceOrderId ?? null,
        ownerMemberId: ctx.payload.ownerMemberId ?? null,
        status: 'open',
        ...provenanceValues(ctx.provenance),
      })
      .returning({ id: obligation.id, proceedingId: obligation.proceedingId });
    if (!row) throw new Error('obligation handler: insert returned no row');
    return {
      undoPayload: { obligationId: row.id },
      entityRefs: {
        obligationIds: [row.id],
        matterId: ctx.payload.matterId,
        proceedingId: row.proceedingId,
      },
      summary: 'Recorded an obligation from an order',
      matterId: ctx.payload.matterId,
      proceedingId: row.proceedingId,
    };
  },

  async undo(scope, activity) {
    const { obligation } = schema;
    const obligationId = activity.undoPayload?.['obligationId'];
    if (typeof obligationId !== 'string') throw conflict('The obligation id is missing');
    await scope.tx
      .delete(obligation)
      .where(
        and(eq(obligation.workspaceId, activity.workspaceId), eq(obligation.id, obligationId)),
      );
  },
};
