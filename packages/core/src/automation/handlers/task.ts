// `task` (#47): a task, optionally on a matter or proceeding and with a due date. A dated task is a
// proposal (the matrix); an undated one may be created unasked at confidence >= 0.8. Undo deletes it.
import { schema } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { conflict } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { day, parsePayload, provenanceValues, uuid } from './common.ts';

const Payload = z.strictObject({
  title: z.string().trim().min(1).max(500),
  dueDate: day.nullable().optional(),
  matterId: uuid.nullable().optional(),
  proceedingId: uuid.nullable().optional(),
  ownerMemberId: uuid.nullable().optional(),
});
type Payload = z.output<typeof Payload>;

export const taskHandler: ProposalHandler<Payload> = {
  kind: 'task',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const { task } = schema;
    const [row] = await scope.tx
      .insert(task)
      .values({
        workspaceId: scope.actor.workspaceId,
        title: ctx.payload.title,
        dueDate: ctx.payload.dueDate ?? null,
        matterId: ctx.payload.matterId ?? null,
        proceedingId: ctx.payload.proceedingId ?? null,
        ownerMemberId: ctx.payload.ownerMemberId ?? null,
        ...provenanceValues(ctx.provenance),
      })
      .returning({ id: task.id, matterId: task.matterId, proceedingId: task.proceedingId });
    if (!row) throw new Error('task handler: insert returned no row');
    return {
      undoPayload: { taskId: row.id },
      entityRefs: { taskIds: [row.id], matterId: row.matterId, proceedingId: row.proceedingId },
      summary: 'Added a task',
      matterId: row.matterId,
      proceedingId: row.proceedingId,
    };
  },

  async undo(scope, activity) {
    const { task } = schema;
    const taskId = activity.undoPayload?.['taskId'];
    if (typeof taskId !== 'string') throw conflict('The task id is missing');
    await scope.tx
      .delete(task)
      .where(and(eq(task.workspaceId, activity.workspaceId), eq(task.id, taskId)));
  },
};
