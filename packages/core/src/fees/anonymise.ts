// DPDP erasure for the client ledger (#83 part 3, ADR 0048): the money columns stay (the books and
// the statutory retention duty), the free text goes. Sets `anonymised_at` and clears `description`,
// which the `client_ledger_entry_anonymised_chk` CHECK requires to go together. Idempotent.
import { schema, withWorkspace } from '@causedeck/db';
import { and, eq, isNull } from 'drizzle-orm';

import { record } from '../audit/index.ts';
import type { FeesActor, FeesDeps } from './scope.ts';

const { clientLedgerEntry } = schema;

/**
 * Anonymises every ledger line of `personId` in the workspace; returns how many were changed. It is
 * the erasure sweep's own step, so it needs no role or flag (an erasure must run with the flag off
 * too); callers are the DPDP erasure paths, never a user action.
 */
export async function anonymiseClientLedger(
  deps: Pick<FeesDeps, 'db' | 'now'>,
  actor: FeesActor,
  personId: string,
): Promise<number> {
  const now = deps.now?.() ?? new Date();
  return withWorkspace(deps.db, actor, async (tx) => {
    const rows = await tx
      .update(clientLedgerEntry)
      .set({ description: null, anonymisedAt: now })
      .where(
        and(
          eq(clientLedgerEntry.workspaceId, actor.workspaceId),
          eq(clientLedgerEntry.personId, personId),
          isNull(clientLedgerEntry.anonymisedAt),
        ),
      )
      .returning({ id: clientLedgerEntry.id });
    if (rows.length > 0) {
      await record(
        { db: tx, workspaceId: actor.workspaceId, actor: { userId: actor.userId, kind: 'user' } },
        {
          action: 'fee.ledger_anonymised',
          target: { kind: 'person', id: personId },
          metadata: { entries: rows.length },
        },
      );
    }
    return rows.length;
  });
}
