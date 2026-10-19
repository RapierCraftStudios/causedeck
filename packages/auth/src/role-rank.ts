// The role list and its order (ADR 0004, architecture §6.3), with no better-auth imports, so the
// permission policy (and every client bundle that imports it) stays free of the auth library.
// `roles.ts` re-exports these alongside the Better Auth access-control roles.

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
