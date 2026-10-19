// Where `/` sends a visitor (#179): signed in, to the last workspace they opened (`cd_last_ws`) or
// their first, or to onboarding when they belong to none; signed out, the placeholder home.
import { cookies } from 'next/headers';

import { LAST_WORKSPACE_COOKIE, pickLandingSlug } from './workspace-context.ts';

export interface HomeSession {
  /** `null` when the signed-in user belongs to no workspace yet. */
  lastWorkspaceSlug: string | null;
}

/** The signed-in user's landing workspace, or `null` when signed out. */
export async function getHomeSession(): Promise<HomeSession | null> {
  // Loaded lazily so this module stays free of the database until a request needs it.
  const { loadMemberships } = await import('./workspace-loader.ts');
  const loaded = await loadMemberships();
  if (!loaded) return null;
  const last = (await cookies()).get(LAST_WORKSPACE_COOKIE)?.value;
  return { lastWorkspaceSlug: pickLandingSlug(loaded.memberships, last) };
}

/**
 * Signed in with a workspace: that workspace's Today. Signed in without one: onboarding. Signed
 * out: `null`, and `/` renders the placeholder home (which links to `/sign-in`).
 */
export function homeDestination(
  session: HomeSession | null,
): `/w/${string}/today` | '/onboarding' | null {
  if (!session) return null;
  if (session.lastWorkspaceSlug) {
    return `/w/${encodeURIComponent(session.lastWorkspaceSlug)}/today`;
  }
  return '/onboarding';
}
