// Content-Security-Policy and locale negotiation for proxy.ts, kept pure so they are unit-tested.
import { defaultLocale, isLocale, type Locale } from '../i18n/routing.ts';

/** A fresh, unguessable nonce for one request (128 bits, base64). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCodePoint(...bytes));
}

/** Strict nonce-based CSP. Styles stay `'unsafe-inline'` because Sonner and next-themes inject them. */
export function buildCsp(
  nonce: string,
  {
    dev = false,
    uploadOrigin,
    reportUrl,
  }: { dev?: boolean; uploadOrigin?: string | undefined; reportUrl?: string | undefined } = {},
): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The browser PUTs uploads straight to the object store through a presigned URL (#217, #436).
    `connect-src 'self'${uploadOrigin === undefined ? '' : ` ${uploadOrigin}`}`,
    // The push service worker (#197): `strict-dynamic` would otherwise ignore `'self'` for workers.
    "worker-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Violations go to the API's report route (#104); Caddy's `Reporting-Endpoints` names `csp-endpoint`.
    ...(reportUrl === undefined ? [] : [`report-uri ${reportUrl}`, 'report-to csp-endpoint']),
  ];
  return directives.join('; ');
}

/**
 * The origin presigned upload URLs point at: the custom endpoint (MinIO, path-style) when
 * `S3_ENDPOINT` is set, else the bucket's AWS virtual-hosted host. `undefined` when the storage env
 * is absent or malformed, so the page falls back to `'self'` only.
 */
export function cspReportUrlOf(env: { API_URL?: string | undefined }): string | undefined {
  try {
    return env.API_URL === undefined || env.API_URL === ''
      ? undefined
      : new URL('/v1/csp-report', env.API_URL).href;
  } catch {
    return undefined;
  }
}

export function uploadOriginOf(env: {
  S3_ENDPOINT?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_REGION?: string | undefined;
}): string | undefined {
  try {
    if (env.S3_ENDPOINT !== undefined && env.S3_ENDPOINT !== '') {
      return new URL(env.S3_ENDPOINT).origin;
    }
    if (env.S3_BUCKET === undefined || env.S3_REGION === undefined) return undefined;
    return new URL(`https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`).origin;
  } catch {
    return undefined;
  }
}

/** First supported locale from an `Accept-Language` header, by quality; `en` when none match. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return defaultLocale;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return {
        base: tag.trim().toLowerCase().split('-')[0] ?? '',
        q: q ? Number(q.slice(2)) : 1,
        index,
      };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked.map((entry) => entry.base).find(isLocale) ?? defaultLocale;
}

/** Cookie wins, then `Accept-Language`, then `en`. The user setting slots in between with #12. */
export function negotiateLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (cookie && isLocale(cookie)) return cookie;
  return localeFromAcceptLanguage(acceptLanguage);
}
