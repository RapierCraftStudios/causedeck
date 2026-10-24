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
