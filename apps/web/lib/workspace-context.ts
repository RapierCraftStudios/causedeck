// The workspace the shell is rendering, and who the user is in it. Pure types and helpers: client
// modules (nav, commands, shortcuts) import `can()` from here, so the database loader lives in the
// server-only `lib/workspace-loader.ts` (#179). Roles, permissions and `can()` come from the
// central policy in `@causedeck/auth/policy` (#231, #234); flag keys from `@causedeck/flags` (#22).
import type { Action, Role } from '@causedeck/auth/policy';
import type { FlagKey } from '@causedeck/flags/keys';

/** Workspace roles, most privileged first (`ROLES` in `@causedeck/auth/policy`). */
export type { Role };

/** Permissions the shell gates on: policy actions. */
export type Permission = Action;

/**
 * `can(role, permission)`: the policy's role-only decision (`roleCan`), the same module the
 * server's `assertCan` uses, so nav, commands and shortcuts never carry rules of their own.
 */
export { roleCan as can, MATRIX } from '@causedeck/auth/policy';

/** Feature flags the shell gates on: the typed registry keys from `@causedeck/flags`. */
export type { FlagKey };

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
