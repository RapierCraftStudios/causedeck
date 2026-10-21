// The default `AuditSink` (#227, #26 part 2): the offboarding service's `member.removed` event
// becomes an `audit_event` row written through `record()` inside the caller's transaction.
// `setAuditSink` (workspaces/offboarding.ts) still swaps it out in tests.
import type { AuditSink } from '../shared/audit-sink.ts';
import { record } from './writer.ts';

export const recordAuditSink: AuditSink = {
  write: (tx, event) =>
    record(
      {
        db: tx,
        workspaceId: event.workspaceId,
        actor: { userId: event.actorUserId, kind: 'user' },
      },
      {
        action: event.action,
        target: { kind: 'user', id: event.targetUserId },
        metadata: { reassignedTo: event.reassignedTo },
      },
    ),
};
