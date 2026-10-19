// The role-to-action matrix: the minimum role for each action (#231). This is the single source of
// truth; `docs/engineering/permissions.md` is generated from it (`pnpm docs:permissions`).
import { atLeast, ROLES, type Role } from '../role-rank';
import type { Action } from './actions';

export const MATRIX: Readonly<Record<Action, Role>> = {
  'workspace.manage': 'advocate',
  // Slug rename stays owner-only (#177); `workspace.manage` is the advocate-level setting edit.
  'workspace.rename': 'owner',
  'workspace.delete': 'owner',
  // Advocates may invite unless the workspace turns `advocatesCanInvite` off (see `can()`).
  'member.invite': 'advocate',
  'member.remove': 'owner',
  // Role changes and ownership transfer.
  'member.role': 'owner',
  'billing.manage': 'owner',
  'billing.read': 'owner',
  'invoices.read': 'owner',
  'matter.read': 'viewer',
  'matter.write': 'junior',
  'matter.restrict': 'advocate',
  'strategy.read': 'junior',
  'memory.read': 'junior',
  'memory.write': 'junior',
  'document.read': 'viewer',
  'document.write': 'clerk',
  'task.read': 'viewer',
  'task.write': 'clerk',
  'listing.read': 'viewer',
  'draft.write': 'junior',
  'audit.read': 'advocate',
  'export.run': 'owner',
  'limitation.read': 'junior',
  'insights.read': 'advocate',
  'settings.read': 'clerk',
};

/** Matter-scoped actions a junior may take only on assigned, shared or own matters. */
export const JUNIOR_MATTER_SCOPED: ReadonlySet<Action> = new Set<Action>([
  'matter.read',
  'matter.write',
  'strategy.read',
  'memory.read',
  'memory.write',
  'document.read',
  'document.write',
  'task.read',
  'task.write',
  'draft.write',
]);

/** Roles the matrix grants `action` to, most privileged first. */
export function rolesFor(action: Action): Role[] {
  return ROLES.filter((role) => atLeast(role, MATRIX[action]));
}
