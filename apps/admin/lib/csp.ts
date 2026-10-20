// Content-Security-Policy and the response headers every admin response carries (#309). Pure, so
// next.config.ts, proxy.ts and the generic 404 share one list and the header tests cover it.

/** A fresh, unguessable nonce for one request (128 bits, base64). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCodePoint(...bytes));
}

/** Strict nonce CSP for console pages. No framing, no plugins, no foreign origins. */
export function buildCsp(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // next-themes injects its theme script's style; same as apps/web.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ');
}

/** CSP of the generic 404: it renders nothing active. Static, so every 404 is byte-identical. */
export const NOT_FOUND_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Headers on every admin response, pages, APIs and 404s alike. */
export const ADMIN_SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

/** Set the admin security headers (and `csp`) on `headers`, replacing any earlier values. */
export function applySecurityHeaders(headers: Headers, csp: string): Headers {
  for (const { key, value } of ADMIN_SECURITY_HEADERS) headers.set(key, value);
  headers.set('Content-Security-Policy', csp);
  return headers;
}
