// The single generic 404 (#309). Every gate denial (no session, not staff, no 2FA, IP or Cloudflare
// Access failure) and every closed path answers with exactly these bytes, so probing cannot tell an
// existing route from a missing one, or a denied user from an anonymous one.
import { applySecurityHeaders, NOT_FOUND_CSP } from './csp.ts';

export const NOT_FOUND_BODY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>404: Not found</title></head><body><h1>404</h1><p>Not found.</p></body></html>';

export function notFoundResponse(): Response {
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  applySecurityHeaders(headers, NOT_FOUND_CSP);
  return new Response(NOT_FOUND_BODY, { status: 404, headers });
}
