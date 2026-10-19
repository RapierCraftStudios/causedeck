// Workspace roles (ADR 0004, architecture §6.3). The role list lives in `role-rank.ts` (no
// better-auth imports, so client bundles can use it); the Better Auth organization plugin (#152)
// and the permission policy `can()` (#20) both build on it.
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';

import type { Role } from './role-rank';

export { atLeast, isRole, ROLE_RANK, ROLES, type Role } from './role-rank';

/** Better Auth's organization statements plus the app's own resources. */
export const statement = {
  ...defaultStatements,
  matter: ['create', 'read', 'update', 'delete'],
} as const;

export const ac = createAccessControl(statement);

/** Access-control roles for the organization plugin, keyed by role name. */
export const roles = {
  owner: ac.newRole({
    organization: ['update', 'delete'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    team: ['create', 'update', 'delete'],
    ac: ['create', 'read', 'update', 'delete'],
    matter: ['create', 'read', 'update', 'delete'],
  }),
  advocate: ac.newRole({
    organization: ['update'],
    member: ['create', 'update', 'delete'],
    invitation: ['create', 'cancel'],
    team: ['create', 'update', 'delete'],
    ac: ['read'],
    matter: ['create', 'read', 'update', 'delete'],
  }),
  junior: ac.newRole({
    ac: ['read'],
    matter: ['create', 'read', 'update'],
  }),
  clerk: ac.newRole({
    ac: ['read'],
    matter: ['read', 'update'],
  }),
  viewer: ac.newRole({
    ac: ['read'],
    matter: ['read'],
  }),
} satisfies Record<Role, ReturnType<typeof ac.newRole>>;
