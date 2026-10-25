// Storage audit events (#217). The same pattern as the `@causedeck/core` audit sink, kept local
// because packages may not import core; the real writer (audit log table) is #26.
import type { Queryable } from '@causedeck/db';

export interface StorageAuditEvent {
  action: 'document.upload_finalized' | 'document.download_url_issued';
  workspaceId: string;
  actorUserId: string;
  blobId: string;
  at: Date;
}

export interface StorageAuditSink {
  write(tx: Queryable, event: StorageAuditEvent): Promise<void>;
}

export const noopStorageAuditSink: StorageAuditSink = {
  write: () => Promise.resolve(),
};

let active: StorageAuditSink = noopStorageAuditSink;

/** The installed sink; delegates so callers can hold a stable reference. */
export const storageAuditSink: StorageAuditSink = {
  write: (tx, event) => active.write(tx, event),
};

/** Install a sink (#26, tests); `null` restores the no-op default. */
export function setStorageAuditSink(sink: StorageAuditSink | null): void {
  active = sink ?? noopStorageAuditSink;
}
