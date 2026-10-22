// Server-only workspace loader (#179): who is signed in, which workspace a slug points at, and the
// user's memberships, all from the session and the database. Never import from a client component;
// the pure types and `can()` live in `workspace-context.ts`, which client modules share.
import type { MembershipSummary, ResolvedSlug } from '@causedeck/core/workspaces';
import { cache } from 'react';

import type { AppSession } from './auth.ts';
import type {
  Membership,
  Role,
  WorkspaceContext,
  WorkspaceContextResult,
} from './workspace-context.ts';

/** Everything the loader reads, injectable for unit tests. Defaults hit the real session and DB. */
export interface WorkspaceLoaderDeps {
  getSession: () => Promise<AppSession | null>;
  /** `userId` is the signed-in user, pinned as the acting user while the workspace row is read. */
  resolveSlug: (slug: string, userId: string) => Promise<ResolvedSlug | null>;
  listMemberships: (userId: string) => Promise<MembershipSummary[]>;
}

const ROLES: readonly string[] = [
  'viewer',
  'clerk',
  'junior',
  'advocate',
  'owner',
] satisfies Role[];

function isRole(value: string): value is Role {
  return ROLES.includes(value);
}

/** Loaded lazily so importing this module never opens a connection or reads request headers. */
async function defaultDeps(): Promise<WorkspaceLoaderDeps> {
  const [{ getSession }, runtime] = await Promise.all([
    import('./auth.ts'),
    import('@causedeck/core/runtime'),
  ]);
  return {
    getSession,
    resolveSlug: (slug, userId) => runtime.resolveSlugFor(slug, userId),
    listMemberships: (userId) => runtime.listMembershipsFor(userId),
  };
}

function toMemberships(rows: readonly MembershipSummary[]): Membership[] {
  return rows.flatMap((row) =>
    isRole(row.role)
      ? [{ workspace: { id: row.workspaceId, slug: row.slug, name: row.name }, role: row.role }]
      : [],
  );
}

async function resolveDeps(deps: Partial<WorkspaceLoaderDeps> = {}): Promise<WorkspaceLoaderDeps> {
  if (deps.getSession && deps.resolveSlug && deps.listMemberships) {
    return deps as WorkspaceLoaderDeps;
  }
  return { ...(await defaultDeps()), ...deps };
}

/** The signed-in user's active memberships in live workspaces, or `null` when signed out. */
export async function loadMemberships(
  deps?: Partial<WorkspaceLoaderDeps>,
): Promise<{ session: AppSession; memberships: Membership[] } | null> {
  const { getSession, listMemberships } = await resolveDeps(deps);
  const session = await getSession();
  if (!session) return null;
  return { session, memberships: toMemberships(await listMemberships(session.user.id)) };
}

/**
 * The context for `slug`. `not-found` when signed out, the slug is unknown, expired or points at a
 * soft-deleted workspace, or the user is not an active member, so nothing about a workspace leaks.
 * `redirect` when `slug` is an old slug of a workspace the user belongs to (90-day history), or a
 * differently-cased current slug. `no-workspaces` when the user belongs to no workspace at all.
 */
export async function loadWorkspaceContext(
  slug: string,
  deps?: Partial<WorkspaceLoaderDeps>,
): Promise<WorkspaceContextResult> {
  const resolved = await resolveDeps(deps);
  const loaded = await loadMemberships(resolved);
  if (!loaded) return { kind: 'not-found' };
  if (loaded.memberships.length === 0) return { kind: 'no-workspaces' };
  const target = await resolved.resolveSlug(slug, loaded.session.user.id);
  if (!target) return { kind: 'not-found' };
  const current = loaded.memberships.find((m) => m.workspace.id === target.workspace.id);
  if (!current) return { kind: 'not-found' };
  if (target.redirectFrom !== null || current.workspace.slug !== slug) {
    return { kind: 'redirect', slug: current.workspace.slug };
  }
  const { user } = loaded.session;
  const context: WorkspaceContext = {
    user: { id: user.id, name: user.name ?? user.email, email: user.email },
    workspace: current.workspace,
    role: current.role,
    memberships: loaded.memberships,
  };
  return { kind: 'ok', context };
}

/** `loadWorkspaceContext` with the real session and DB, memoised per request (layout + page). */
export const getWorkspaceResult = cache((slug: string): Promise<WorkspaceContextResult> =>
  loadWorkspaceContext(slug),
);

/** The context for `slug`, or `null` for anything but a member on the workspace's current slug. */
export async function getWorkspaceContext(slug: string): Promise<WorkspaceContext | null> {
  const result = await getWorkspaceResult(slug);
  return result.kind === 'ok' ? result.context : null;
}
