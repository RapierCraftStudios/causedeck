// Raw MIME retention (#54 part 3, #530): the raw message of a received email lives 30 days
// (`intake_message.raw_expires_at`) unless pinned. The sweep asks the provider to delete the
// source object and clears `raw_mime_ref`; the stored body text, captures and proposals remain.
// Idempotent: a swept row no longer matches.
import { schema, withWorkspace, type Database, type Transaction } from '@causedeck/db';
import type { InboundEmailProvider } from '@causedeck/capture';
import { and, eq, isNotNull, lte } from 'drizzle-orm';

const { intakeMessage } = schema;

/** Raw messages deleted per sweep of one workspace; the next run takes the rest. */
export const RAW_MIME_BATCH = 500;

export async function sweepExpiredRawMime(
  deps: {
    db: Database | Transaction;
    provider: Pick<InboundEmailProvider, 'discardRaw'>;
    now?: () => Date;
  },
  workspaceId: string,
  intakeMessageId?: string,
): Promise<{ deleted: number }> {
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, { workspaceId }, async (tx) => {
    const due = await tx
      .select({ id: intakeMessage.id, ref: intakeMessage.rawMimeRef })
      .from(intakeMessage)
      .where(
        and(
          eq(intakeMessage.workspaceId, workspaceId),
          isNotNull(intakeMessage.rawMimeRef),
          lte(intakeMessage.rawExpiresAt, now),
          eq(intakeMessage.pinned, false),
          ...(intakeMessageId === undefined ? [] : [eq(intakeMessage.id, intakeMessageId)]),
        ),
      )
      .limit(RAW_MIME_BATCH);
    for (const { id, ref } of due) {
      if (ref !== null) await deps.provider.discardRaw?.(ref);
      await tx
        .update(intakeMessage)
        .set({ rawMimeRef: null })
        .where(and(eq(intakeMessage.id, id), eq(intakeMessage.workspaceId, workspaceId)));
    }
    return { deleted: due.length };
  });
}
