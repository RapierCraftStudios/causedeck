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
  // The source registry in the staff console (#478, D-048). Metadata holds the old and new value of
  // every changed field (`old_<field>`, `new_<field>`).
  'source.changed': {
    security: true,
    description: 'Staff created or changed an external data source or flipped its kill switch',
  },
  // The court document network (#485, D-048). Metadata holds ids and counts only, never content.
  'network.contributed': {
    security: false,
    description: 'A public court document was contributed to the shared court document network',
  },
  'network.withdrawn': {
    security: false,
    description: "A workspace's contributions to the court document network were withdrawn",
  },
  // Global court-data controls (#486, D-048). Metadata holds counts, source ids and a subject hash only.
  'court_data.expired': {
    security: false,
    description: "Court documents past their source's retention were blanked",
  },
  'court_data.erased': {
    security: true,
    description: "Staff masked a person's name in the shared court-data stores on request",
  },
  // The conflict-of-interest check (#500, D-048). Fail-closed: a check that cannot be audited is not
  // run. Metadata holds counts only, never names.
  'conflict.checked': {
    security: true,
    description: 'A member checked new matter parties for a conflict of interest',
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
  // Public API keys (#624): fail-closed. Metadata holds the key's scopes (created) or nothing.
  'api_key.created': { security: true, description: 'An owner or admin issued a public API key' },
  'api_key.revoked': { security: true, description: 'An owner or admin revoked a public API key' },
  // Per-organisation SSO (#683): fail-closed. Metadata holds the protocol, domain and enabled flag,
  // never the provider settings (client secrets, certificates).
  'sso.provider_created': { security: true, description: 'An owner added an SSO provider' },
  'sso.provider_updated': { security: true, description: 'An owner changed an SSO provider' },
  'sso.provider_deleted': { security: true, description: 'An owner removed an SSO provider' },
  'sso.domain_verified': {
    security: true,
    description: 'An owner proved control of an SSO provider domain by DNS',
  },
  // Bulk provisioning (#684): fail-closed. A run's metadata holds its source, counts and a dry-run
  // flag (never the addresses); a provisioned or deprovisioned member names the source and change.
  'provisioning.run': {
    security: true,
    description: 'A bulk member provisioning run (CSV) finished',
  },
  'member.provisioned': {
    security: true,
    description: 'A member was added, reactivated or changed by SCIM provisioning',
  },
  'member.deprovisioned': {
    security: true,
    description: 'A member was suspended or removed by SCIM provisioning',
  },
  'scim_token.created': {
    security: true,
    description: 'An owner issued a SCIM provisioning token',
  },
  'scim_token.revoked': {
    security: true,
    description: 'An owner revoked a SCIM provisioning token',
  },
  // Change webhooks (#626): fail-closed. Metadata holds the subscribed event types (created) or nothing.
  'webhook_endpoint.created': {
    security: true,
    description: 'A workspace manager registered a webhook endpoint',
  },
  'webhook_endpoint.deleted': {
    security: true,
    description: 'A workspace manager removed a webhook endpoint',
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
  // Fail-closed: it decides whether grid corrections may enter eval sets (#558). Owner-only; ids only,
  // so the target is the workspace and no metadata is kept.
  'workspace.eval_reuse_enabled': {
    security: true,
    description: 'An owner allowed corrections to be reused in evaluation sets (opt-in)',
  },
  'workspace.eval_reuse_disabled': {
    security: true,
    description:
      'An owner stopped corrections being reused in evaluation sets; item consents withdrawn',
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
  // Lawyer memory (#72): an owner changed whether an M4 court note is visible to the chamber.
  // Metadata holds the note id and the new state, never its text.
  'memory.sharing_changed': {
    security: true,
    description: 'An owner shared an M4 court note with the chamber or made it private again',
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
  'capture.recording_deleted': {
    security: false,
    description: 'A voice recording and its transcript were deleted by a member; proposals stay',
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
  // Obligation service (#67). Ids and flags only, never the description.
  'obligation.created': { security: false, description: 'An obligation was created' },
  'obligation.updated': { security: false, description: 'An obligation was edited' },
  'obligation.rescheduled': {
    security: false,
    description: 'An obligation was rescheduled, with a reason',
  },
  'obligation.closed': {
    security: false,
    description: 'An obligation was closed by a person, with a reason',
  },
  'obligation.reopened': { security: false, description: 'A closed obligation was reopened' },
  'obligation.direction_not_applicable': {
    security: false,
    description: 'An order direction was marked not applicable, in words',
  },
  'obligation.defect_raised': { security: false, description: 'A registry defect was raised' },
  'obligation.defect_cured': { security: false, description: 'A registry defect was cured' },
  'obligation.represented': { security: false, description: 'A filing was re-presented' },
  'obligation.registry_number': {
    security: false,
    description: 'A registry SR or FR number was stored',
  },
  'obligation.copy_applied': { security: false, description: 'A certified copy was applied for' },
  'obligation.copy_transitioned': {
    security: false,
    description: 'A certified copy moved to its next step',
  },
  'outward.prepared': { security: false, description: 'An outward update draft was prepared' },
  'outward.edited': { security: false, description: 'A lawyer saved an edit of an outward draft' },
  'outward.shared': {
    security: false,
    description: 'A lawyer shared an outward draft from their own channel',
  },
  // Continuity (#71): who generated, read, saved or acknowledged a handover; ids only, never note text.
  'handover.generated': { security: false, description: 'A handover note was assembled for a matter' },
  'handover.saved': { security: false, description: 'A handover note version was saved and addressed' },
  'handover.read': { security: false, description: 'Handover notes of a matter were read' },
  'handover.acknowledged': { security: false, description: 'A handover note was acknowledged' },
  'continuity.changes_read': {
    security: false,
    description: 'What changed on a matter since the last view was read',
  },
  // The WhatsApp number link (#711): ids only, never the number or the code.
  'whatsapp.otp_requested': {
    security: true,
    description: 'A WhatsApp link code was requested and sent',
  },
  'whatsapp.otp_failed': { security: true, description: 'A wrong WhatsApp link code was entered' },
  'whatsapp.linked': { security: true, description: 'A WhatsApp number was verified and linked' },
  // The lawyer's manual "court is at item N" hall marker (#58): an internal note, ids and numbers only.
  'court_day.marker_set': {
    security: false,
    description: 'A manual court-is-at-item marker was set for a hall',
  },
  'court_day.marker_cleared': {
    security: false,
    description: 'A manual court-is-at-item marker was cleared',
  },
  // A confirmed hearing outcome (#62): ids, kinds and counts only, never the outcome text.
  'hearing.outcome_confirmed': {
    security: true,
    description: 'A person confirmed a hearing outcome, its next date, obligations and tasks',
  },
  // Chamber delegation of appearances (#63): ids only, never the delegator's note.
  'appearance.assigned': {
    security: false,
    description: 'An appearance was assigned to a member',
  },
  'appearance.reassigned': {
    security: false,
    description: 'An appearance moved to another member; the previous assignee is recorded',
  },
  'appearance.unassigned': {
    security: false,
    description: 'A member was removed from an appearance',
  },
  'matter.access_granted': {
    security: true,
    description:
      'An owner granted a member access to a restricted matter to delegate an appearance',
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
