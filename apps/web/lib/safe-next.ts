// Open-redirect guard for `?next=` (spike §6). Only same-origin, relative paths survive; anything
// else (other origins, protocol-relative `//host`, `/\host`, schemes, control characters) becomes
// the fallback. Pure, so the proxy, RSC pages and client components can all share it.

const PROBE_ORIGIN = 'http://next.invalid';

/** `raw` when it is a safe same-origin relative path, otherwise `fallback`. */
export function safeNextPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  if (!raw.startsWith('/')) return fallback;
  // `//host` and `/\host` are protocol-relative in browsers; backslashes are normalised to `/`.
  if (raw.startsWith('//') || raw.includes('\\')) return fallback;
  // Browsers strip tabs and newlines from URLs, which can turn `/\t/host` into `//host`.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point.
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/sign-in`, carrying `pathWithSearch` as `next` when it is a safe destination. */
export function signInPathFor(pathWithSearch: string | null | undefined): string {
  const next = safeNextPath(pathWithSearch, '');
  return next === '' || next === '/' ? '/sign-in' : `/sign-in?next=${encodeURIComponent(next)}`;
}
