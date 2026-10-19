// Flag-change audit events (#22). The same pattern as the `@causedeck/core` audit sink, kept local
// because packages may not import core; the real writer (audit log table) is #26.
import type { Queryable } from '@causedeck/db';

import type { FlagKey } from './keys.ts';

export interface FlagAuditEvent {
  action: 'flag.changed';
  actorUserId: string;
  key: FlagKey;
  /** `null` for a global row. */
  workspaceId: string | null;
  /** `null` when there was no row before. */
  oldValue: boolean | null;
  newValue: boolean;
  /** The legal acknowledgement recorded with a legal-gated enable. */
  legalAckNote?: string;
  at: Date;
}

export interface FlagAuditSink {
  write(tx: Queryable, event: FlagAuditEvent): Promise<void>;
}

export const noopFlagAuditSink: FlagAuditSink = {
  write: () => Promise.resolve(),
};

let active: FlagAuditSink = noopFlagAuditSink;

/** The installed sink; delegates so callers can hold a stable reference. */
export const flagAuditSink: FlagAuditSink = {
  write: (tx, event) => active.write(tx, event),
};

/** Install a sink (#26, tests); `null` restores the no-op default. */
export function setFlagAuditSink(sink: FlagAuditSink | null): void {
  active = sink ?? noopFlagAuditSink;
}
