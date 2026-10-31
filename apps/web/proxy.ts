// Next.js 16 proxy (formerly `middleware.ts`; runs on the Node runtime). Per request: a CSP nonce
// shared with the renderer via `x-nonce`, a default `NEXT_LOCALE` cookie, and the signed-out
// redirect for protected routes (#153). The proxy only checks that a session cookie is present;
// the session itself is validated in server components (`app/(app)/layout.tsx`).
import {
  parseSignupChannel,
  SIGNUP_CHANNEL_COOKIE,
  SIGNUP_CHANNEL_MAX_AGE_SECONDS,
} from '@causedeck/auth/signup-channel';
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

import { LOCALE_COOKIE } from './i18n/routing.ts';
import {
  buildCsp,
  createNonce,
  cspReportUrlOf,
  negotiateLocale,
  uploadOriginOf,
} from './lib/csp.ts';
import { isDev, serverEnv } from './lib/env.ts';
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

/** Where the browser may PUT presigned uploads; `undefined` when the storage env is unavailable. */
function uploadOrigin(): string | undefined {
  try {
    return uploadOriginOf(serverEnv());
  } catch {
    return undefined;
  }
}

/** The API's CSP report route; `undefined` when the server env is unavailable. */
function cspReportUrl(): string | undefined {
  try {
    return cspReportUrlOf(serverEnv());
  } catch {
    return undefined;
  }
}

/** `/s/<token>`: the public client status link page (#88). */
export function isStatusLinkPath(pathname: string): boolean {
  return pathname.startsWith('/s/');
}

export function proxy(request: NextRequest): NextResponse {
  // A share that reached the server (no service worker yet) has no page to POST to: the files were
  // never read, so send the person to the share screen's "share from another app" empty state.
  if (request.method === 'POST' && request.nextUrl.pathname === '/share-target') {
    return NextResponse.redirect(new URL('/share-target', request.url), 303);
  }
  const nonce = createNonce();
  const csp = buildCsp(nonce, {
    dev: isDev(),
    uploadOrigin: uploadOrigin(),
    reportUrl: cspReportUrl(),
  });

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
  if (isStatusLinkPath(request.nextUrl.pathname)) {
    // The signed-out client status page (#88): never indexed, never leaks the token in a referrer.
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  // Education and tagged links (#703): remember a known `?channel=` across the sign-in round trip
  // so the user.create hook can record it. Only a closed-list value is stored; anything else
  // (including a stale cookie from an earlier link) is left alone or ignored.
  if (request.method === 'GET' && request.nextUrl.pathname === '/sign-in') {
    const channel = parseSignupChannel(request.nextUrl.searchParams.get('channel'));
    if (channel !== null) {
      response.cookies.set(SIGNUP_CHANNEL_COOKIE, channel, {
        path: '/',
        maxAge: SIGNUP_CHANNEL_MAX_AGE_SECONDS,
        sameSite: 'lax',
        httpOnly: true,
        secure: request.nextUrl.protocol === 'https:',
      });
    }
  }

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
      source:
        '/((?!_next/static|_next/image|favicon.ico|healthz|readyz|sw.js|manifest.webmanifest|icons/|screenshots/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
