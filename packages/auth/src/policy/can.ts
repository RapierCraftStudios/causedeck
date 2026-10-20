// `can()`: the pure permission decision (#231). No IO, never throws; RLS is the backstop.
import { atLeast, ROLE_RANK, ROLES, type Role } from '../role-rank';
import { domainOf, isAction, WRITE_ACTIONS, type Action, type ActionDomain } from './actions';
import { JUNIOR_MATTER_SCOPED, MATRIX } from './matrix';

export const DENY_REASONS = [
  'ROLE_DENIED',
  'RESTRICTED_MATTER',
  'CROSS_WORKSPACE',
  'NOT_ASSIGNED',
  'FEATURE_OFF',
  'SUSPENDED',
  'STAFF_READ_ONLY',
] as const;
export type DenyReason = (typeof DENY_REASONS)[number];

export type Decision = { allow: true } | { allow: false; reason: DenyReason };

export interface Actor {
  userId: string;
  workspaceId: string;
  role: Role;
  /** Matters the actor is assigned to; only consulted for juniors. */
  assignedMatterIds?: ReadonlySet<string>;
  suspended?: boolean;
  /**
   * `'staff'` for platform staff acting in a support session (#308): read-only, so every write
   * action is denied. Absent means a workspace member (`'user'`).
   */
  kind?: 'user' | 'staff';
}

/** Workspace settings the caller supplies; omitted keys take the defaults. */
export interface PolicySettings {
  /** Default true. */
  advocatesCanInvite?: boolean;
  /** Default true: advocates may read and export the audit log (`audit.read`). */
  advocatesCanReadAudit?: boolean;
  /** Default true: owners see restricted matters they are not listed on. */
  ownersSeeRestrictedMatters?: boolean;
  /** Domains switched off for the workspace (feature flags, plan). */
  disabledDomains?: ReadonlySet<ActionDomain>;
}

export interface Resource {
  kind: string;
  workspaceId: string;
  matterId?: string;
  restricted?: { allowUserIds: readonly string[] };
  ownerUserId?: string;
}

const ALLOW: Decision = { allow: true };

const WRITES: ReadonlySet<Action> = new Set(WRITE_ACTIONS);

function deny(reason: DenyReason): Decision {
  return { allow: false, reason };
}

export function can(
  actor: Actor,
  action: Action,
  resource?: Resource,
  settings: PolicySettings = {},
): Decision {
  // Runtime default deny for anything outside the action list (untyped callers).
  if (!isAction(action)) return deny('ROLE_DENIED');
  if (resource !== undefined && resource.workspaceId !== actor.workspaceId) {
    return deny('CROSS_WORKSPACE');
  }
  if (actor.kind === 'staff' && WRITES.has(action)) return deny('STAFF_READ_ONLY');
  if (actor.suspended === true) return deny('SUSPENDED');
  if (settings.disabledDomains?.has(domainOf(action)) === true) return deny('FEATURE_OFF');
  if (!atLeast(actor.role, MATRIX[action])) return deny('ROLE_DENIED');
  if (
    action === 'member.invite' &&
    actor.role === 'advocate' &&
    settings.advocatesCanInvite === false
  ) {
    return deny('ROLE_DENIED');
  }
  if (
    action === 'audit.read' &&
    actor.role === 'advocate' &&
    settings.advocatesCanReadAudit === false
  ) {
    return deny('ROLE_DENIED');
  }
  if (resource === undefined) return ALLOW;

  const listed = resource.restricted?.allowUserIds.includes(actor.userId) === true;
  if (resource.restricted !== undefined && !listed) {
    const ownerSees = actor.role === 'owner' && settings.ownersSeeRestrictedMatters !== false;
    if (!ownerSees) return deny('RESTRICTED_MATTER');
  }
  if (
    actor.role === 'junior' &&
    JUNIOR_MATTER_SCOPED.has(action) &&
    resource.matterId !== undefined &&
    actor.assignedMatterIds?.has(resource.matterId) !== true &&
    !listed &&
    resource.ownerUserId !== actor.userId
  ) {
    return deny('NOT_ASSIGNED');
  }
  return ALLOW;
}

/**
 * The role-only decision (no resource, no actor identity): what the shell gates nav, commands and
 * buttons on. Goes through `can()` so the role rules exist once.
 */
export function roleCan(role: Role, action: Action, settings?: PolicySettings): boolean {
  return can({ userId: '', workspaceId: '', role }, action, undefined, settings).allow;
}

/** Roles `role` may invite: every role ranked below it, or none without `member.invite`. */
export function invitableRoles(role: Role, settings?: PolicySettings): Role[] {
  if (!roleCan(role, 'member.invite', settings)) return [];
  return ROLES.filter((candidate) => ROLE_RANK[candidate] < ROLE_RANK[role]);
}
