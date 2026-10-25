// `duplicate_merge` (#47): a capture that repeats a document (`document.near_duplicate` or an
// identical sha256) is folded into the original: the duplicate joins the original's matter and
// version chain, so one document answers for both. Applied unasked, as an activity with undo.
// Undo gives the duplicate its earlier matter and chain position back.
import { schema } from '@causedeck/db';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { conflict, notFound } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { parsePayload, uuid } from './common.ts';

const Payload = z
  .strictObject({ documentId: uuid, duplicateOfDocumentId: uuid })
  .refine((p) => p.documentId !== p.duplicateOfDocumentId, {
    message: 'A document cannot duplicate itself',
  });
type Payload = z.output<typeof Payload>;

export const duplicateMergeHandler: ProposalHandler<Payload> = {
  kind: 'duplicate_merge',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const { document } = schema;
    const { workspaceId } = scope.actor;
    const rows = await scope.tx
      .select({
        id: document.id,
        matterId: document.matterId,
        supersedesDocumentId: document.supersedesDocumentId,
      })
      .from(document)
      .where(
        and(
          eq(document.workspaceId, workspaceId),
          inArray(document.id, [ctx.payload.documentId, ctx.payload.duplicateOfDocumentId]),
        ),
      );
    const duplicate = rows.find((r) => r.id === ctx.payload.documentId);
    const original = rows.find((r) => r.id === ctx.payload.duplicateOfDocumentId);
    if (duplicate === undefined || original === undefined) throw notFound('Document not found');
    await scope.tx
      .update(document)
      .set({
        matterId: original.matterId,
        supersedesDocumentId: original.id,
        updatedAt: scope.now(),
      })
      .where(and(eq(document.workspaceId, workspaceId), eq(document.id, duplicate.id)));
    return {
      undoPayload: {
        documentId: duplicate.id,
        previousMatterId: duplicate.matterId,
        previousSupersedesDocumentId: duplicate.supersedesDocumentId,
      },
      entityRefs: { documentIds: [duplicate.id, original.id], matterId: original.matterId },
      summary: 'Merged a duplicate document into the original',
      matterId: original.matterId,
    };
  },

  async undo(scope, activity) {
    const { document } = schema;
    const payload = activity.undoPayload as {
      documentId?: string;
      previousMatterId?: string | null;
      previousSupersedesDocumentId?: string | null;
    } | null;
    if (payload?.documentId === undefined) throw conflict('The document id is missing');
    await scope.tx
      .update(document)
      .set({
        matterId: payload.previousMatterId ?? null,
        supersedesDocumentId: payload.previousSupersedesDocumentId ?? null,
        updatedAt: scope.now(),
      })
      .where(
        and(eq(document.workspaceId, activity.workspaceId), eq(document.id, payload.documentId)),
      );
  },
};
