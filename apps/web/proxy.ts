// Next.js 16 proxy (formerly `middleware.ts`; runs on the Node runtime). Per request: a CSP nonce
// shared with the renderer via `x-nonce`, and a default `NEXT_LOCALE` cookie. No auth logic (#12).
import { NextResponse, type NextRequest } from 'next/server';

import { LOCALE_COOKIE } from './i18n/routing.ts';
import { buildCsp, createNonce, negotiateLocale } from './lib/csp.ts';
import { isDev } from './lib/env.ts';

const ONE_YEAR = 60 * 60 * 24 * 365;

export function proxy(request: NextRequest): NextResponse {
  const nonce = createNonce();
  const csp = buildCsp(nonce, { dev: isDev() });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Next.js reads the nonce from the request CSP header and stamps it on its own scripts.
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
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
