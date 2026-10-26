// Withdraw a workspace's contributions (#485). `app_withdraw_contributions` (migration 0067) drops
// the workspace's ledger rows and blanks every copy no other workspace still stands behind: it
// needs to see other workspaces' ledger rows, which row-level security hides from the app role.
import { sql } from 'drizzle-orm';
import { withWorkspace, type Queryable } from '@causedeck/db';

import { record } from '../audit/index.ts';

/** Withdraw everything `workspaceId` contributed; returns how many shared copies were blanked. */
export async function withdrawContributions(db: Queryable, workspaceId: string): Promise<number> {
  return withWorkspace(db, { workspaceId }, async (tx) => {
    const rows = await tx.execute<{ n: number }>(
      sql`select app_withdraw_contributions(${workspaceId}::uuid) as n`,
    );
    const blanked = rows[0]?.n ?? 0;
    await record(
      { db: tx, workspaceId, actor: { userId: null, kind: 'system' } },
      {
        action: 'network.withdrawn',
        target: { kind: 'workspace', id: workspaceId },
        metadata: { blankedCopies: String(blanked) },
      },
    );
    return blanked;
  });
}
