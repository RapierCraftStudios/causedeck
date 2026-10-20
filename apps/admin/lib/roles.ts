// The staff role matrix (#309, part of #27). Kept free of server-only imports so the console nav (a
// client component) can filter its items with the same table the server enforces.
//   support: metadata and consented support sessions;  ops: adapters and flags;  admin: everything.

/** Staff session lifetime: 8 hours, then sign in (and pass the 2FA step) again. */
export const STAFF_SESSION_SECONDS = 8 * 60 * 60;

/** Mirrors `schema.STAFF_ROLES` (`staff_user.role`); a test keeps the two equal. */
export const STAFF_ROLES = ['support', 'ops', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Console areas, one per nav item. */
export const STAFF_CAPABILITIES = [
  'overview',
  'adapters',
  'flags',
  'workspaces',
  'support',
  'audit',
] as const;
export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

export const STAFF_ROLE_MATRIX: Readonly<Record<StaffRole, readonly StaffCapability[]>> = {
  support: ['overview', 'workspaces', 'support', 'audit'],
  ops: ['overview', 'adapters', 'flags', 'audit'],
  admin: STAFF_CAPABILITIES,
};

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Whether `role` may reach `capability`. Unknown roles reach nothing. */
export function canStaff(role: StaffRole, capability: StaffCapability): boolean {
  return isStaffRole(role) && STAFF_ROLE_MATRIX[role].includes(capability);
}

/**
 * The local dev staff account, created by `pnpm --filter @causedeck/admin staff:seed-dev`. Outside
 * production, and for this account only, the gate skips the IP allowlist and the 2FA step.
 */
export const DEV_STAFF_EMAIL = 'staff@causedeck.local';
