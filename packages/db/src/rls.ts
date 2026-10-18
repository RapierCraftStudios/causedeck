// Workspace context per transaction (spike §4.1). This is the minimal helper the job runner (#15)
// needs: it pins `app.workspace_id` (and `app.user_id`) with `SET LOCAL` semantics for one
// transaction. #19 adds the RLS policies that read the setting, nesting checks and
// `withoutWorkspace`; the signature here is the one #19 specifies, so callers do not change.
import { sql } from 'drizzle-orm';

import type { Database, Transaction } from './client.ts';

export interface WorkspaceScope {
  workspaceId: string;
  userId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * Run `fn` in a transaction scoped to one workspace. The settings are transaction-local
 * (`set_config(..., true)`), so a pooled connection reused later carries no workspace.
 */
export async function withWorkspace<T>(
  db: Database,
  { workspaceId, userId }: WorkspaceScope,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(workspaceId)) throw new TypeError('withWorkspace: workspaceId must be a uuid');
  if (userId !== undefined && !isUuid(userId)) {
    throw new TypeError('withWorkspace: userId must be a uuid');
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.workspace_id', ${workspaceId}, true), set_config('app.user_id', ${userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
