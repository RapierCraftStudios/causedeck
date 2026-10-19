// The offboarding audit-sink contract (#178, #227, #293). Shared so the default `record()`-backed
// sink in `audit/sink.ts` and the offboarding service in `workspaces/offboarding.ts` (which
// re-exports these types) can both name it without the two domains importing each other.
import type { Database, Transaction } from '@causedeck/db';

type Queryable = Database | Transaction;

export interface AuditEvent {
  action: 'member.removed';
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  /** The user who took over open work, or `null` when there was none to reassign. */
  reassignedTo: string | null;
  at: Date;
}

/**
 * Where offboarding sends its audit event. The default writes an `audit_event` row through
 * `record()` in the caller's transaction (security action: a failed write fails the removal).
 */
export interface AuditSink {
  write(tx: Queryable, event: AuditEvent): Promise<void>;
}
