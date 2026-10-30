// Applying a mask request (#892, D-053, ADR 0051 §Takedown): staff act on a court order or request.
// The judgment's title is masked, its anonymised text is re-redacted from the raw `page_text` with
// the request's names removed, and the derived retrieval cache (the embedding) is cleared in the same
// transaction, so nothing derived from the unmasked text is served afterwards; the 72 h purge window
// of the issue is an upper bound this meets at once. `page_text` and `sha256` are never touched.
// The request is stamped `applied` with `handled_at`, and the action is audited.
import { schema, withUser, type Queryable } from '@causedeck/db';
import { redactJudgment } from '@causedeck/intelligence';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { record } from '../audit/index.ts';

const { judgment, corpusMaskRequest, staffUser } = schema;

/** The longest a mask may take to reach every served copy (hours); `applyMaskRequest` does it at once. */
export const MASK_PURGE_DEADLINE_HOURS = 72;

export type MaskErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'ALREADY_HANDLED';

export class MaskRequestError extends Error {
  constructor(
    readonly code: MaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MaskRequestError';
  }
}

export interface MaskActor {
  userId: string;
}

export interface MaskOutcome {
  requestId: string;
  judgmentId: string;
  maskReason: string;
  handledAt: Date;
}

/** Apply one pending mask request. Staff only (ops or admin); audited. */
export async function applyMaskRequest(
  db: Queryable,
  actor: MaskActor,
  requestId: string,
): Promise<MaskOutcome> {
  return withUser(db, { userId: actor.userId }, async (tx) => {
    const [staff] = await tx
      .select({ userId: staffUser.userId })
      .from(staffUser)
      .where(
        and(
          eq(staffUser.userId, actor.userId),
          inArray(staffUser.role, ['ops', 'admin']),
          isNull(staffUser.disabledAt),
        ),
      );
    if (!staff) throw new MaskRequestError('FORBIDDEN', 'Only ops or admin staff can apply a mask');

    const [request] = await tx
      .select()
      .from(corpusMaskRequest)
      .where(eq(corpusMaskRequest.id, requestId));
    if (!request) throw new MaskRequestError('NOT_FOUND', 'No such mask request');
    if (request.status !== 'pending')
      throw new MaskRequestError('ALREADY_HANDLED', 'The mask request was already handled');

    // The raw text is read here only to re-redact it; it is never returned.
    const [row] = await tx
      .select({ pageText: judgment.pageText, bench: judgment.bench })
      .from(judgment)
      .where(eq(judgment.id, request.judgmentId));
    if (!row) throw new MaskRequestError('NOT_FOUND', 'The judgment of the request is not in the corpus');

    const maskReason = `mask_request:${request.id}`;
    const redacted = redactJudgment({
      pages: row.pageText,
      bench: row.bench,
      extraNames: request.names,
      forceMask: { reason: maskReason },
    });
    await tx
      .update(judgment)
      .set({
        redactedText: redacted.pages,
        caseTitle: redacted.caseTitle,
        titleMasked: true,
        redactionVersion: redacted.redactionVersion,
        sensitiveCategory: redacted.sensitiveCategory,
        maskReason,
        embedding: null,
      })
      .where(eq(judgment.id, request.judgmentId));

    const handledAt = new Date();
    await tx
      .update(corpusMaskRequest)
      .set({ status: 'applied', handledAt, handledBy: actor.userId })
      .where(eq(corpusMaskRequest.id, request.id));
    await record(
      { db: tx, workspaceId: null, actor: { userId: actor.userId, kind: 'staff' } },
      {
        action: 'corpus.mask_applied',
        target: { kind: 'judgment', id: request.judgmentId },
        metadata: {
          requestId: request.id,
          requestedBy: request.requestedBy,
          legalBasis: request.legalBasis,
          names: request.names.length,
        },
      },
    );
    return { requestId: request.id, judgmentId: request.judgmentId, maskReason, handledAt };
  });
}
