// `document_attach` (#47): attach a captured document to a matter. Unasked only when the input
// matched the matter by case number or CNR at score >= 0.9 (the matrix); otherwise a proposal.
// Undo puts the document back where it was (usually unattached).
import { schema } from '@causedeck/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { conflict, notFound } from '../../shared/errors.ts';
import type { ProposalHandler } from '../types.ts';

import { parsePayload, uuid } from './common.ts';

const Payload = z.strictObject({ documentId: uuid, matterId: uuid });
type Payload = z.output<typeof Payload>;

export const documentAttachHandler: ProposalHandler<Payload> = {
  kind: 'document_attach',
  enabled: true,
  validate: (payload) => parsePayload(Payload, payload),

  async apply(scope, ctx) {
    const { document, matter } = schema;
    const { workspaceId } = scope.actor;
    const [target] = await scope.tx
      .select({ id: matter.id, status: matter.status })
      .from(matter)
      .where(and(eq(matter.workspaceId, workspaceId), eq(matter.id, ctx.payload.matterId)))
      .limit(1);
    if (target === undefined) throw notFound('Matter not found');
    if (target.status === 'archived') throw conflict('The matter is archived');
    const [row] = await scope.tx
      .select({ id: document.id, matterId: document.matterId })
      .from(document)
      .where(and(eq(document.workspaceId, workspaceId), eq(document.id, ctx.payload.documentId)))
      .limit(1)
      .for('update');
    if (row === undefined) throw notFound('Document not found');
    await scope.tx
      .update(document)
      .set({ matterId: target.id, updatedAt: scope.now() })
      .where(and(eq(document.workspaceId, workspaceId), eq(document.id, row.id)));
    return {
      undoPayload: { documentId: row.id, previousMatterId: row.matterId },
      entityRefs: { documentIds: [row.id], matterId: target.id },
      summary: 'Attached a document to a matter',
      matterId: target.id,
    };
  },

  async undo(scope, activity) {
    const { document } = schema;
    const payload = activity.undoPayload as {
      documentId?: string;
      previousMatterId?: string | null;
    } | null;
    if (payload?.documentId === undefined) throw conflict('The document id is missing');
    await scope.tx
      .update(document)
      .set({ matterId: payload.previousMatterId ?? null, updatedAt: scope.now() })
      .where(
        and(eq(document.workspaceId, activity.workspaceId), eq(document.id, payload.documentId)),
      );
  },
};
