// `new_proceeding` (#47): create a proceeding with `createProceeding`, identifiers normalised by the
// service. Undo deletes it, which the database refuses while anything still hangs off it (the
// cascade undoes its children first).
import { schema } from '@causedeck/db';
import { PROCEEDING_KINDS } from '@causedeck/validators/matter-graph';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { createProceeding } from '../../matter-graph/index.ts';
import { conflict } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { day, parsePayload, pgCode, uuid } from './common.ts';

const text = z.string().trim().min(1);
const Payload = z.strictObject({
  matterId: uuid,
  forumId: uuid,
  caseType: text,
  kind: z.enum(PROCEEDING_KINDS).optional(),
  number: text.nullable().optional(),
  year: z.int().nullable().optional(),
  srNo: text.nullable().optional(),
  frNo: text.nullable().optional(),
  diaryNo: text.nullable().optional(),
  filingNo: text.nullable().optional(),
  cnr: text.nullable().optional(),
  filingDate: day.nullable().optional(),
  parentProceedingId: uuid.nullable().optional(),
  titlePetitioner: z.string().nullable().optional(),
  titleRespondent: z.string().nullable().optional(),
});
type Payload = z.output<typeof Payload>;

export const newProceedingHandler: ProposalHandler<Payload> = {
  kind: 'new_proceeding',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const row = await createProceeding(scope.deps, scope.actor, {
      ...ctx.payload,
      provenance: ctx.provenance,
    });
    return {
      undoPayload: { proceedingId: row.id, matterId: row.matterId },
      entityRefs: { proceedingId: row.id, matterId: row.matterId },
      summary: 'Added a proceeding',
      matterId: row.matterId,
      proceedingId: row.id,
    };
  },

  async undo(scope, activity) {
    const proceedingId = activity.undoPayload?.['proceedingId'];
    if (typeof proceedingId !== 'string') throw conflict('The proceeding id is missing');
    const { proceeding } = schema;
    try {
      await scope.tx.transaction((sp) =>
        sp
          .delete(proceeding)
          .where(
            and(eq(proceeding.workspaceId, activity.workspaceId), eq(proceeding.id, proceedingId)),
          ),
      );
    } catch (error) {
      if (pgCode(error) === '23503') {
        throw conflict('The proceeding has records of its own now; remove them first');
      }
      throw error;
    }
  },
};
