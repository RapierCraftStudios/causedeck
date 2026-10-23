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

/** Every audit action. #27 (support sessions) wires the call sites for its actions. */
export const AUDIT_ACTIONS = {
  'member.removed': { security: true, description: 'A member was removed from the workspace' },
  'member.role_changed': { security: true, description: "A member's role was changed" },
  'flag.changed': { security: true, description: 'A feature flag was changed' },
  // The two-person legal-gated flag enable in the staff console (#311).
  'flag.change_requested': {
    security: true,
    description: 'Staff requested enabling a legal-gated feature flag',
  },
  'flag.change_approved': {
    security: true,
    description: 'A second admin approved enabling a legal-gated feature flag',
  },
  'flag.change_rejected': {
    security: true,
    description: 'A legal-gated feature flag enable request was rejected or withdrawn',
  },
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
  'support.session_started': { security: true, description: 'A support session started' },
  'support.session_ended': { security: true, description: 'A support session ended' },
  // Fail-closed: a support read whose audit event cannot be written is not served (#308).
  'support.view': {
    security: true,
    description: 'Staff read workspace content in a support session',
  },
  'access.denied': { security: true, description: 'An action was denied' },
  // Admin console (#309). Fail-closed: a staff metadata read that cannot be audited is not run.
  'staff.read': {
    security: true,
    description: 'Staff read platform metadata in the admin console',
  },
  'staff.two_factor_verified': {
    security: true,
    description: 'Staff passed the admin console two-factor step for a session',
  },
  'usage.budget_override_set': {
    security: true,
    description: 'A staff member set a workspace AI budget override',
  },
  'usage.budget_override_expired': {
    security: true,
    description: 'A staff member expired a workspace AI budget override early',
  },
  'audit.retention_purged': {
    security: true,
    description: 'Audit events older than the retention window were purged',
  },
  'billing.subscription_changed': {
    security: true,
    description: 'An owner changed the plan or seats, or cancelled or resumed the subscription',
  },
  'billing.gstin_updated': {
    security: true,
    description: "An owner saved or cleared the workspace's GSTIN",
  },
  // Fail-closed: an invoice PDF whose download cannot be audited is not served (#258).
  'billing.invoice_downloaded': {
    security: true,
    description: 'An owner downloaded a SaaS invoice PDF',
  },
  // Fail-closed: an export whose own audit event cannot be written is refused (#229).
  'audit.exported': { security: true, description: 'The audit log was exported' },
  // Workspace data export (#301): fail-closed, so an export or download that cannot be audited is
  // refused.
  'export.requested': { security: true, description: 'An owner requested a workspace data export' },
  'export.download_link_issued': {
    security: true,
    description: 'A download link for a workspace data export was issued to its requester',
  },
  'export.downloaded': { security: true, description: 'A workspace data export was downloaded' },
  // Workspace deletion (#302): fail-closed. Metadata holds the deletion job id and dates only. These
  // events are purged with the workspace in the final erase step; the receipt keeps the chain head.
  'workspace.deletion_requested': {
    security: true,
    description: 'An owner requested deletion of the workspace (14-day cooling-off)',
  },
  'workspace.deletion_cancelled': {
    security: true,
    description: 'An owner cancelled a pending workspace deletion',
  },
  'workspace.deletion_started': {
    security: true,
    description: 'The cooling-off ended and erasure of the workspace started',
  },
  // Metadata names the changed fields only, never their values (#284).
  'workspace.profile_updated': {
    security: false,
    description: "The workspace's name, kind, time zone, default locale or practice city changed",
  },
  // Fail-closed: a slug rename that cannot be audited does not happen (#284).
  'workspace.slug_renamed': {
    security: true,
    description: 'An owner renamed the workspace slug; the old slug redirects for 90 days',
  },
  // Fail-closed: it changes who may invite and who sees restricted matters (#285). Metadata names the
  // changed settings and their new on/off values.
  'workspace.role_settings_updated': {
    security: true,
    description: 'An owner changed whether advocates may invite or owners see restricted matters',
  },
  // Fail-closed: it changes how sensitive matters start and how long raw audio is kept (#286).
  // Metadata names the changed settings and their new values.
  'workspace.privacy_updated': {
    security: true,
    description: 'A member changed the sensitive-matter default or the raw audio retention window',
  },
  // Fail-closed: it creates or replaces the intake address or ICS feed token, so the old one stops
  // working (#287). Metadata names the kind only, never the token or its hash.
  'workspace.integration_token_rotated': {
    security: true,
    description: 'A member created or rotated the email intake address or ICS feed token',
  },
  // Account-level (`workspaceId: null`); metadata names the changed fields only (#289).
  'account.profile_updated': {
    security: false,
    description: 'A user changed their own account profile (display name)',
  },
  // Data lifecycle (#303). Account events are account-level (`workspaceId: null`); fail-closed, so
  // a deletion or erasure that cannot be audited does not happen. Metadata holds ids and counts.
  'account.deletion_requested': {
    security: true,
    description: 'A user requested the deletion of their account',
  },
  // Step-up authentication (#304). Like `access.denied`, the gate logs a failed write and still
  // refuses. Workspace chain for an owner's workspace action, account-level for account deletion.
  // Metadata names the refused action only.
  'auth.step_up_required': {
    security: true,
    description:
      'An owner-only lifecycle action was refused: no passkey or TOTP verification in the last 10 minutes',
  },
  'account.deletion_blocked': {
    security: true,
    description: 'An account deletion was refused: the user is the only owner of a workspace',
  },
  'account.deleted': {
    security: true,
    description: 'An account was deleted and its audit attribution anonymised',
  },
  'memory.erasure_requested': {
    security: true,
    description: "An owner requested the erasure of the workspace's memory and embeddings",
  },
  'memory.erased': {
    security: true,
    description: "The workspace's memory and embeddings were erased",
  },
  // Capture inbox (#43). Metadata holds the channel, MIME type, size and flags; never a filename or
  // file content. Channel changes and quarantines are fail-closed: they change where a lawyer's
  // data may flow or record a threat.
  'capture.created': {
    security: false,
    description: 'A capture was created and an upload URL issued, or a typed note was captured',
  },
  'capture.completed': {
    security: false,
    description: 'A capture upload was verified and queued, or found to be a duplicate',
  },
  'capture.quarantined': {
    security: true,
    description: 'A capture failed the virus scan and its raw object was moved to quarantine',
  },
  'capture.discarded': {
    security: false,
    description: 'A capture was discarded; its raw object is deleted by the retention job',
  },
  'capture.channel_enabled': {
    security: true,
    description: 'A capture channel was enabled after the data-flow disclosure was shown',
  },
  'capture.channel_disabled': {
    security: true,
    description: 'A capture channel was disabled',
  },
  // Email forward-in intake (#54 part 2). Fail-closed: they change who can put mail into the
  // workspace. Metadata holds ids, the allow-list kind and the domain; never an address' local part
  // and never a sender address.
  'email_intake.address_created': {
    security: true,
    description: 'A private email intake address was created for a member',
  },
  'email_intake.address_rotated': {
    security: true,
    description: 'A private email intake address was replaced; the old address stopped working',
  },
  'email_intake.address_revoked': {
    security: true,
    description: 'A private email intake address was revoked',
  },
  'email_intake.allowlist_added': {
    security: true,
    description: 'A sender was added to the email intake allow-list',
  },
  'email_intake.allowlist_removed': {
    security: true,
    description: 'A sender was removed from the email intake allow-list',
  },
  'workspace.settings_viewed': {
    security: false,
    description: 'Workspace settings were opened',
  },
  // Automation engine (#47). Fail-closed where the system acted or was reversed: an action that
  // cannot be audited does not happen. Metadata holds ids, kind, level and counts, never content.
  'automation.submitted': {
    security: false,
    description: 'Drafts were submitted to the automation engine',
  },
  'automation.applied': {
    security: true,
    description: 'The automation engine applied a change without asking (L3)',
  },
  'automation.accepted': {
    security: true,
    description: 'A person accepted (or edited and accepted) a proposal',
  },
  'automation.dismissed': { security: false, description: 'A person dismissed a proposal' },
  'automation.expired': { security: false, description: 'Proposals expired unanswered' },
  'automation.undone': {
    security: true,
    description: 'An auto-applied change, or a whole capture, was undone',
  },
  'automation.reassigned': {
    security: true,
    description: "A capture's results were moved to another matter",
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
