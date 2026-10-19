// Audit action registry and record() input types (#227, #26 part 2). Every action written to
// `audit_event` is named here and flagged security or informational: a security action that cannot
// be audited fails the action (fail-closed), an informational one is logged and dropped
// (fail-open). Only security actions store the client IP. See docs/engineering/audit.md.
import type { Queryable, schema } from '@causedeck/db';

type AuditRow = typeof schema.auditEvent.$inferSelect;
export type AuditActorKind = AuditRow['actorKind'];
export type AuditOutcome = AuditRow['outcome'];

export interface AuditActionSpec {
  /** Fail-closed and IP-bearing when true; fail-open with a log when false. */
  security: boolean;
  description: string;
}

/** Every audit action. #229 (export) and #27 (support sessions) wire the call sites for theirs. */
export const AUDIT_ACTIONS = {
  'member.removed': { security: true, description: 'A member was removed from the workspace' },
  'member.role_changed': { security: true, description: "A member's role was changed" },
  'flag.changed': { security: true, description: 'A feature flag was changed' },
  'auth.sign_in': { security: true, description: 'A user signed in' },
  'auth.sign_in_failed': { security: true, description: 'A sign-in attempt failed' },
  'auth.magic_link_requested': { security: true, description: 'A magic link was requested' },
  'auth.passkey_added': { security: true, description: 'A passkey was registered' },
  'auth.passkey_removed': { security: true, description: 'A passkey was removed' },
  'auth.two_factor_enabled': {
    security: true,
    description: 'Two-factor authentication was enabled',
  },
  'auth.two_factor_disabled': {
    security: true,
    description: 'Two-factor authentication was disabled',
  },
  'auth.session_revoked': { security: true, description: 'A session was revoked' },
  'audit.exported': { security: true, description: 'The audit log was exported' },
  'support.session_started': { security: true, description: 'A support session started' },
  'support.session_ended': { security: true, description: 'A support session ended' },
  'access.denied': { security: true, description: 'An action was denied' },
  'usage.budget_override_set': {
    security: true,
    description: 'A staff member set a workspace AI budget override',
  },
  'audit.retention_purged': {
    security: true,
    description: 'Audit events older than the retention window were purged',
  },
  'workspace.settings_viewed': {
    security: false,
    description: 'Workspace settings were opened',
  },
} as const satisfies Record<string, AuditActionSpec>;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

export function isAuditAction(action: string): action is AuditAction {
  return Object.hasOwn(AUDIT_ACTIONS, action);
}

export function isSecurityAction(action: AuditAction): boolean {
  return AUDIT_ACTIONS[action].security;
}

export type AuditMetadataValue = string | number | boolean | null;

export interface AuditEventInput {
  action: AuditAction;
  target?: { kind: string; id: string };
  outcome?: AuditOutcome;
  /** Identifiers and flags only, never matter content (see `assertRedacted`). */
  metadata?: Record<string, AuditMetadataValue>;
}

/** Who acted and where. `workspaceId: null` writes to the account-level chain. */
export interface AuditContext {
  db: Queryable;
  workspaceId: string | null;
  actor: { userId: string | null; kind: AuditActorKind };
  requestId?: string;
  /** Raw user agent; only its sha256 is stored. */
  userAgent?: string;
  /** Client IP; stored for security actions only. */
  ip?: string;
}
