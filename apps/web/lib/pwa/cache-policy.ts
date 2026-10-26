// What the service worker may keep in Cache Storage (#50). The worker caches the app shell and
// hashed static assets only; anything that can carry tenant data goes to the network and is never
// stored: `/api/*`, server actions, RSC payloads, and every signed-in route. Kept apart from
// `app/sw.ts` so the rule is unit-tested (the worker file runs only inside a worker).
export const SHARE_PATH = '/share-target';

/** Path prefixes of tenant data and of signed-in pages. */
export const TENANT_PREFIXES = ['/api/', '/w/', '/account', '/onboarding', SHARE_PATH] as const;

/** Whether a request may carry tenant data (so it is network-only and never cached). */
export function isTenantRequest(request: Request, url: URL): boolean {
  const { pathname } = url;
  if (TENANT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return true;
  }
  return (
    request.headers.has('next-action') ||
    request.headers.has('rsc') ||
    url.searchParams.has('_rsc') ||
    request.headers.has('authorization')
  );
}

/** Hashed, immutable assets: safe to serve cache-first. */
export function isStaticAsset(url: URL): boolean {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

/** The public, data-free page the worker serves for offline court-day and brief navigations (#65). */
export const OFFLINE_SHELL_PATH = '/offline/court-day';

export type OfflineRoute =
  | { kind: 'board'; slug: string; which: 'today' | 'tomorrow' }
  | { kind: 'brief'; slug: string; listingId: string };

const OFFLINE_ROUTE = /^\/w\/([^/]+)\/(?:(today|tomorrow)|briefs\/([^/]+))\/?$/;

/** The court-day route a pathname names, or null: only these may be answered from the device. */
export function parseOfflineRoute(pathname: string): OfflineRoute | null {
  const match = OFFLINE_ROUTE.exec(pathname);
  if (!match) return null;
  const [, slug = '', which, listingId] = match;
  if (which === 'today' || which === 'tomorrow') return { kind: 'board', slug, which };
  return listingId ? { kind: 'brief', slug, listingId } : null;
}

/**
 * A page navigation to a court-day route. When the network fails the worker answers it with the
 * precached shell (`OFFLINE_SHELL_PATH`), which reads the encrypted store on the device. The route
 * itself stays network-only: its response, like every RSC payload and API reply, is never stored.
 */
export function isOfflineShellNavigation(request: Request, url: URL): boolean {
  return (
    request.method === 'GET' &&
    request.destination === 'document' &&
    !request.headers.has('rsc') &&
    !url.searchParams.has('_rsc') &&
    parseOfflineRoute(url.pathname) !== null
  );
}
