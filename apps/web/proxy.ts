// Next.js 16 proxy (formerly `middleware.ts`; runs on the Node runtime). Per request: a CSP nonce
// shared with the renderer via `x-nonce`, a default `NEXT_LOCALE` cookie, and the signed-out
// redirect for protected routes (#153). The proxy only checks that a session cookie is present;
// the session itself is validated in server components (`app/(app)/layout.tsx`).
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

import { LOCALE_COOKIE } from './i18n/routing.ts';
import { buildCsp, createNonce, negotiateLocale } from './lib/csp.ts';
import { isDev } from './lib/env.ts';
import { signInPathFor } from './lib/safe-next.ts';
import { LAST_WORKSPACE_COOKIE } from './lib/workspace-context.ts';

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Routes that need a signed-in user: `/w/**`, `/account` and `/onboarding`. */
export function isProtectedPath(pathname: string): boolean {
  return /^\/(?:w|account|onboarding)(?:\/|$)/.test(pathname);
}

const WORKSPACE_PATH = /^\/w\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/i;

/** The workspace slug of a `/w/<slug>/...` path, lowercased, or `null`. */
export function workspaceSlugOf(pathname: string): string | null {
  const slug = WORKSPACE_PATH.exec(pathname)?.[1];
  return slug === undefined || slug.length > 48 ? null : slug.toLowerCase();
}

/** Path and query of the request, for `x-pathname` and `?next=`. */
function pathWithSearch(request: NextRequest): string {
  return `${request.nextUrl.pathname}${request.nextUrl.search}`;
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildCsp(nonce, { dev: isDev() });

  let response: NextResponse;
  if (isProtectedPath(request.nextUrl.pathname) && !getSessionCookie(request)) {
    response = NextResponse.redirect(new URL(signInPathFor(pathWithSearch(request)), request.url));
  } else if (/^\/w\/?$/.test(request.nextUrl.pathname)) {
    // A bare `/w` has no page: `/` lands the user on their last workspace (or onboarding).
    response = NextResponse.redirect(new URL('/', request.url));
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-nonce', nonce);
    // Next.js reads the nonce from the request CSP header and stamps it on its own scripts.
    requestHeaders.set('Content-Security-Policy', csp);
    // Lets server components send a signed-out user back here after sign-in.
    requestHeaders.set('x-pathname', pathWithSearch(request));
    response = NextResponse.next({ request: { headers: requestHeaders } });
    // Remember the last workspace for `/` and bare `/w`; both re-check it against the user's
    // memberships, so a stale or foreign slug here is harmless.
    const slug = workspaceSlugOf(request.nextUrl.pathname);
    if (slug && request.cookies.get(LAST_WORKSPACE_COOKIE)?.value !== slug) {
      response.cookies.set(LAST_WORKSPACE_COOKIE, slug, {
        path: '/',
        maxAge: ONE_YEAR,
        sameSite: 'lax',
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
      });
    }
  }
  response.headers.set('Content-Security-Policy', csp);

  if (!request.cookies.has(LOCALE_COOKIE)) {
    const locale = negotiateLocale(undefined, request.headers.get('accept-language'));
    response.cookies.set(LOCALE_COOKIE, locale, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
  }
  return response;
}

export const config = {
  matcher: [
    {
      // Static assets and the health probes need neither a nonce nor a locale.
      source: '/((?!_next/static|_next/image|favicon.ico|healthz|readyz).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
