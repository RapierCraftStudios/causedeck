// Where `/` sends a visitor. Sessions arrive with #12; until then nobody is signed in.
export interface HomeSession {
  lastWorkspaceSlug: string | null;
}

/** The current session. Always `null` until Better Auth lands (#12). */
export function getHomeSession(): Promise<HomeSession | null> {
  return Promise.resolve(null);
}

/**
 * Signed in with a workspace: that workspace's Today. Otherwise `null`, and `/` renders the
 * placeholder home (which links to `/sign-in`).
 * TODO(#12): send anonymous visitors to `/sign-in` once sign-in exists.
 */
export function homeDestination(session: HomeSession | null): `/w/${string}/today` | null {
  if (session?.lastWorkspaceSlug)
    return `/w/${encodeURIComponent(session.lastWorkspaceSlug)}/today`;
  return null;
}
