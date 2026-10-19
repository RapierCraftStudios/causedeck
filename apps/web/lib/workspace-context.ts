// The workspace the shell is rendering, and who the user is in it. Pure types and helpers: client
// modules (nav, commands, shortcuts) import `can()` from here, so the database loader lives in the
// server-only `lib/workspace-loader.ts` (#179). Roles, permissions and flag keys are local unions
// until `@causedeck/auth` (#20) and `@causedeck/flags` (#22) export the real ones.

/** Workspace roles, least to most privileged. TODO(#20): re-export from `@causedeck/auth`. */
export type Role = 'viewer' | 'clerk' | 'junior' | 'advocate' | 'owner';

/** Permissions the shell gates on. TODO(#20): re-export from `@causedeck/auth`. */
export type Permission =
  'billing.read' | 'invoices.read' | 'limitation.read' | 'insights.read' | 'settings.read';

/** Feature flags the shell gates on. TODO(#22): re-export from `@causedeck/flags`. */
export type FlagKey = 'invoices.enabled' | 'limitation.enabled';

export interface Workspace {
  id: string;
  slug: string;
  name: string;
}

export interface Membership {
  workspace: Workspace;
  role: Role;
}

/** The signed-in user, from the Better Auth session. */
export interface ShellUser {
  id: string;
  name: string;
  email: string;
}

export interface WorkspaceContext {
  user: ShellUser;
  workspace: Workspace;
  role: Role;
  /** Every workspace the user belongs to (for the switcher). Never other users' workspaces. */
  memberships: Membership[];
}

/** Role-to-permission table. TODO(#20): replace with the central `can()` policy. */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ['billing.read', 'invoices.read', 'limitation.read', 'insights.read', 'settings.read'],
  advocate: ['limitation.read', 'insights.read', 'settings.read'],
  junior: ['limitation.read', 'settings.read'],
  clerk: ['settings.read'],
  viewer: [],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Last workspace the user opened (`/w/<slug>/...`); set by `proxy.ts`, read by `/` and `/w`. */
export const LAST_WORKSPACE_COOKIE = 'cd_last_ws';

/**
 * Where to land a signed-in user: the last workspace when it is still one of their memberships,
 * otherwise their first, or `null` when they have none (onboarding).
 */
export function pickLandingSlug(
  memberships: readonly Membership[],
  lastSlug: string | null | undefined,
): string | null {
  if (lastSlug) {
    const last = memberships.find((m) => m.workspace.slug === lastSlug.toLowerCase());
    if (last) return last.workspace.slug;
  }
  return memberships[0]?.workspace.slug ?? null;
}

/**
 * An old-slug request `/w/<old>/rest?query` moved to the new slug; `/w/<new>/today` when the path
 * is unknown or bare.
 */
export function movedPath(pathWithSearch: string | null, slug: string): string {
  const rest = pathWithSearch?.match(/^\/w\/[^/?#]+(\/[^?#]+(?:\?[^#]*)?)$/)?.[1];
  return `/w/${encodeURIComponent(slug)}${rest ?? '/today'}`;
}

/**
 * `loadWorkspaceContext` (lib/workspace-loader.ts): a context, an old-slug redirect, a signed-in
 * user with no workspace yet (onboarding), or a 404.
 */
export type WorkspaceContextResult =
  | { kind: 'ok'; context: WorkspaceContext }
  | { kind: 'redirect'; slug: string }
  | { kind: 'no-workspaces' }
  | { kind: 'not-found' };
