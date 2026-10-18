// Workspace roles (ADR 0004, architecture §6.3). This is the one definition of the role list:
// the Better Auth organization plugin (#152) and the permission policy `can()` (#20) build on it.
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/organization/access';

/** Membership roles, most privileged first. */
export const ROLES = ['owner', 'advocate', 'junior', 'clerk', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Higher rank means more privilege. */
export const ROLE_RANK: Readonly<Record<Role, number>> = {
  owner: 4,
  advocate: 3,
  junior: 2,
  clerk: 1,
  viewer: 0,
};

/** True when `role` is `minimum` or above it in the hierarchy. */
export function atLeast(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

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
