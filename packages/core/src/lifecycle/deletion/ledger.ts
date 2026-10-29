// DPDP erasure of the fee ledger (#83, ADR 0048): the erase sweeps the free text of every client
// ledger line before the tenant rows are purged, so no description survives a partial or resumed
// run. The money columns stay (the statutory retention duty); `anonymised_at` and a null
// `description` are set together, as `client_ledger_entry_anonymised_chk` requires. Idempotent.
// The fees domain owns the per-person variant (`anonymiseClientLedger`); lifecycle may not import
// it (core-domains), so this is the erase flow's own bulk step.
import { schema, type Queryable } from '@causedeck/db';
import { and, eq, isNull } from 'drizzle-orm';

const { clientLedgerEntry } = schema;

/** Anonymises every ledger line of the workspace; returns how many were changed. */
export async function anonymiseLedgerOnErasure(
  tx: Queryable,
  workspaceId: string,
  now: Date,
): Promise<number> {
  const rows = await tx
    .update(clientLedgerEntry)
    .set({ description: null, anonymisedAt: now })
    .where(
      and(eq(clientLedgerEntry.workspaceId, workspaceId), isNull(clientLedgerEntry.anonymisedAt)),
    )
    .returning({ id: clientLedgerEntry.id });
  return rows.length;
}
