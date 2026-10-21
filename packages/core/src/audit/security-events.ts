// Security event capture (#228, #26 part 3). `createSecurityEventRecorder` implements the auth
// package's `SecurityEventRecorder` (Better Auth hooks, packages/auth/src/server.ts) on top of
// `record()`: auth events are account-level (`workspaceId: null`) and carry an `emailHash`, never
// an email. The domain helpers below are thin typed wrappers for role changes, access denials,
// flag changes, audit exports and support sessions. See docs/engineering/audit.md.
import { createHash } from 'node:crypto';

import type { SecurityEventInput, SecurityEventRecorder } from '@causedeck/auth/server';
import type { Database, Queryable } from '@causedeck/db';
import { createLogger, type Logger } from '@causedeck/observability';

import type {
  AuditAction,
  AuditActorKind,
  AuditContext,
  AuditMetadataValue,
  AuditOutcome,
} from './events.ts';
import { record } from './writer.ts';

let log: Logger | undefined;
const logger = (): Logger => (log ??= createLogger({ service: 'audit' }));

/** sha256 hex of the normalised address, so repeated requests correlate without storing it. */
export function hashEmail(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function requestFields(
  event: SecurityEventInput,
): Pick<AuditContext, 'ip' | 'userAgent' | 'requestId'> {
  return {
    ...(event.ip === undefined ? {} : { ip: event.ip }),
    ...(event.userAgent === undefined ? {} : { userAgent: event.userAgent }),
    ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
  };
}

function authEvent(
  db: Database,
  action: AuditAction,
  event: SecurityEventInput,
  {
    target,
    outcome,
    withEmail = false,
  }: { target?: { kind: string; id: string }; outcome?: AuditOutcome; withEmail?: boolean } = {},
): Promise<void> {
  const metadata: Record<string, AuditMetadataValue> = {};
  if (event.method !== undefined) metadata.method = event.method;
  if (withEmail && event.email !== undefined) metadata.emailHash = hashEmail(event.email);
  return record(
    {
      db,
      workspaceId: null,
      actor: { userId: event.userId ?? null, kind: 'user' },
      ...requestFields(event),
    },
    {
      action,
      ...(target === undefined ? {} : { target }),
      ...(outcome === undefined ? {} : { outcome }),
      metadata,
    },
  );
}

const sessionTarget = (event: SecurityEventInput) =>
  event.sessionId === undefined ? undefined : { kind: 'session', id: event.sessionId };
const passkeyTarget = (event: SecurityEventInput) =>
  event.passkeyId === undefined ? undefined : { kind: 'passkey', id: event.passkeyId };
const userTarget = (event: SecurityEventInput) =>
  event.userId == null ? undefined : { kind: 'user', id: event.userId };

function opts(target: { kind: string; id: string } | undefined) {
  return target === undefined ? {} : { target };
}

/** The Better Auth security events as account-level audit rows on `db`. */
export function createSecurityEventRecorder(db: Database): SecurityEventRecorder {
  return {
    signInSucceeded: (e) => authEvent(db, 'auth.sign_in', e, opts(sessionTarget(e))),
    signInFailed: (e) =>
      authEvent(db, 'auth.sign_in_failed', e, { outcome: 'denied', withEmail: true }),
    magicLinkRequested: (e) => authEvent(db, 'auth.magic_link_requested', e, { withEmail: true }),
    passkeyAdded: (e) => authEvent(db, 'auth.passkey_added', e, opts(passkeyTarget(e))),
    passkeyRemoved: (e) => authEvent(db, 'auth.passkey_removed', e, opts(passkeyTarget(e))),
    twoFactorEnabled: (e) => authEvent(db, 'auth.two_factor_enabled', e, opts(userTarget(e))),
    twoFactorDisabled: (e) => authEvent(db, 'auth.two_factor_disabled', e, opts(userTarget(e))),
    sessionRevoked: (e) => authEvent(db, 'auth.session_revoked', e, opts(sessionTarget(e))),
  };
}

export interface RoleChangedEvent {
  workspaceId: string;
  actorUserId: string;
  targetUserId: string;
  memberId: string;
  fromRole: string;
  toRole: string;
}

/** `member.role_changed` on the caller's transaction (fails the change if it cannot be written). */
export function recordRoleChanged(tx: Queryable, event: RoleChangedEvent): Promise<void> {
  return record(
    {
      db: tx,
      workspaceId: event.workspaceId,
      actor: { userId: event.actorUserId, kind: 'user' },
    },
    {
      action: 'member.role_changed',
      target: { kind: 'user', id: event.targetUserId },
      metadata: { memberId: event.memberId, fromRole: event.fromRole, toRole: event.toRole },
    },
  );
}

export interface AccessDeniedEvent {
  workspaceId: string;
  /** Whether the actor is a member: members' denials go to the workspace chain. */
  member: boolean;
  actorUserId: string;
  /** The policy action that was denied, when known. */
  action?: string | undefined;
  /** The policy deny reason or domain error code. */
  reason?: string | undefined;
  /** Who was denied; defaults to `'user'`. `'staff'` for writes attempted in a support session. */
  actorKind?: AuditActorKind | undefined;
  /** The support session a staff denial happened in (#308). */
  supportSessionId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

/**
 * `access.denied` in a fresh transaction on the root `db`, so it survives the caller's rolled-back
 * transaction. A non-member's denial is account-level (it must not write into a chain it has no
 * access to). A failed write is logged and swallowed, so it never masks the original FORBIDDEN.
 */
export async function recordAccessDenied(db: Database, event: AccessDeniedEvent): Promise<void> {
  const metadata: Record<string, AuditMetadataValue> = { member: event.member };
  if (event.action !== undefined) metadata.deniedAction = event.action;
  if (event.reason !== undefined) metadata.reason = event.reason;
  if (event.supportSessionId !== undefined) metadata.supportSessionId = event.supportSessionId;
  try {
    await record(
      {
        db,
        workspaceId: event.member ? event.workspaceId : null,
        actor: { userId: event.actorUserId, kind: event.actorKind ?? 'user' },
        ...(event.ip === undefined ? {} : { ip: event.ip }),
        ...(event.userAgent === undefined ? {} : { userAgent: event.userAgent }),
        ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
      },
      {
        action: 'access.denied',
        target: { kind: 'workspace', id: event.workspaceId },
        outcome: 'denied',
        metadata,
      },
    );
  } catch (error) {
    logger().error(
      { err: { name: error instanceof Error ? error.name : 'unknown' }, action: 'access.denied' },
      'access denial not recorded',
    );
  }
}

export interface FlagChangedEvent {
  actorUserId: string;
  key: string;
  /** `null` for a global flag. */
  workspaceId: string | null;
  oldValue: boolean | null;
  newValue: boolean;
  /** Whether a legal acknowledgement was given; its free-text note is never stored. */
  legalAck: boolean;
  /** The approved `flag_change_request` the change applied, when there was one (#311). */
  approvedVia?: string;
}

/** `flag.changed` by staff, on `tx` (global flags go to the account-level chain). */
export function recordFlagChanged(tx: Queryable, event: FlagChangedEvent): Promise<void> {
  return record(
    { db: tx, workspaceId: event.workspaceId, actor: { userId: event.actorUserId, kind: 'staff' } },
    {
      action: 'flag.changed',
      target: { kind: 'flag', id: event.key },
      metadata: {
        oldValue: event.oldValue,
        newValue: event.newValue,
        legalAck: event.legalAck,
        ...(event.approvedVia === undefined ? {} : { approvedVia: event.approvedVia }),
      },
    },
  );
}

/** Structurally `@causedeck/flags` `FlagAuditEvent` (core does not depend on flags). */
type FlagAuditEventLike =
  | {
      action: 'flag.changed';
      actorUserId: string;
      key: string;
      workspaceId: string | null;
      oldValue: boolean | null;
      newValue: boolean;
      legalAckNote?: string;
      /** The approved `flag_change_request` this change applied (#311). */
      requestId?: string;
    }
  | {
      action: 'flag.change_requested' | 'flag.change_approved' | 'flag.change_rejected';
      actorUserId: string;
      key: string;
      workspaceId: string | null;
      requestId: string;
    };

/** A `FlagAuditSink` for `setFlagAuditSink` that writes the flag events through `record()`. */
export const flagChangeAuditSink = {
  write: (tx: Queryable, event: FlagAuditEventLike): Promise<void> => {
    if (event.action !== 'flag.changed') {
      // Request steps (#311): ids and the key only; the note stays out of the audit log.
      return record(
        {
          db: tx,
          workspaceId: event.workspaceId,
          actor: { userId: event.actorUserId, kind: 'staff' },
        },
        {
          action: event.action,
          target: { kind: 'flag_change_request', id: event.requestId },
          metadata: { key: event.key },
        },
      );
    }
    return recordFlagChanged(tx, {
      actorUserId: event.actorUserId,
      key: event.key,
      workspaceId: event.workspaceId,
      oldValue: event.oldValue,
      newValue: event.newValue,
      legalAck: typeof event.legalAckNote === 'string' && event.legalAckNote.length > 0,
      ...(event.requestId === undefined ? {} : { approvedVia: event.requestId }),
    });
  },
};

export interface ExportRunEvent {
  format: string;
  /** ISO dates of the exported range. */
  from: string;
  to: string;
  rowCount?: number;
}

/** `audit.exported`; `exportAudit` (#229) records the same shape inline, ahead of its stream. */
export function recordExportRun(ctx: AuditContext, event: ExportRunEvent): Promise<void> {
  const metadata: Record<string, AuditMetadataValue> = {
    format: event.format,
    from: event.from,
    to: event.to,
  };
  if (event.rowCount !== undefined) metadata.rowCount = event.rowCount;
  return record(ctx, {
    action: 'audit.exported',
    ...(ctx.workspaceId === null ? {} : { target: { kind: 'workspace', id: ctx.workspaceId } }),
    metadata,
  });
}

export interface SupportSessionEvent {
  supportSessionId: string;
  staffUserId: string;
  workspaceId: string;
  /** Why a session ended (`revoked`, `expired`, `staff_disabled`); stored as metadata. */
  endReason?: 'revoked' | 'expired' | 'staff_disabled' | undefined;
}

function supportSession(
  action: 'support.session_started' | 'support.session_ended',
  ctx: Omit<AuditContext, 'workspaceId' | 'actor'>,
  event: SupportSessionEvent,
): Promise<void> {
  return record(
    { ...ctx, workspaceId: event.workspaceId, actor: { userId: event.staffUserId, kind: 'staff' } },
    {
      action,
      target: { kind: 'support_session', id: event.supportSessionId },
      ...(event.endReason === undefined ? {} : { metadata: { endReason: event.endReason } }),
    },
  );
}

/** `support.session_started` by staff in the workspace (wired by `grantSession`, #308). */
export function recordSupportSessionStarted(
  ctx: Omit<AuditContext, 'workspaceId' | 'actor'>,
  event: SupportSessionEvent,
): Promise<void> {
  return supportSession('support.session_started', ctx, event);
}

/**
 * `support.session_ended` by staff in the workspace (wired by `revokeSession`, the expiry job and
 * `endStaffSupportSessions`, #308).
 */
export function recordSupportSessionEnded(
  ctx: Omit<AuditContext, 'workspaceId' | 'actor'>,
  event: SupportSessionEvent,
): Promise<void> {
  return supportSession('support.session_ended', ctx, event);
}

export interface SupportViewEvent {
  supportSessionId: string;
  staffUserId: string;
  workspaceId: string;
  /** What was read: the first target is the event's target, every id goes to `targetIds`. */
  targets: readonly { kind: string; id: string }[];
  /** The policy action the read was checked against (e.g. `matter.read`). */
  action: string;
}

/**
 * `support.view`: staff read workspace content in a support session (#308). Security, so
 * fail-closed: a read that cannot be audited fails with it.
 */
export function recordSupportView(
  ctx: Omit<AuditContext, 'workspaceId' | 'actor'>,
  event: SupportViewEvent,
): Promise<void> {
  const [first] = event.targets;
  if (first === undefined)
    throw new TypeError('recordSupportView: at least one target is required');
  return record(
    { ...ctx, workspaceId: event.workspaceId, actor: { userId: event.staffUserId, kind: 'staff' } },
    {
      action: 'support.view',
      target: first,
      metadata: {
        supportSessionId: event.supportSessionId,
        readAction: event.action,
        targetKinds: [...new Set(event.targets.map((t) => t.kind))].join(','),
        targetIds: event.targets.map((t) => t.id).join(','),
      },
    },
  );
}
