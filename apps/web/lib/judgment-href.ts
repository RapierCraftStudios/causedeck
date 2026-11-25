// In-app judgment links (#1191). A judgment's stored `sourceUrl` is its provenance (often an
// archive-member URL like `…/2026.tar#member.pdf`, which no browser opens), so every source link in
// Research, the copilot and the drafting studio points at the in-app reader instead:
// `/w/<slug>/research/judgments/<id>?page=N&para=M`. The reader opens at page N with paragraph M
// highlighted. Pure: no request state, safe in client and server components.

export interface JudgmentPinpoint {
  page?: number | null | undefined;
  para?: number | null | undefined;
}

const positive = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n > 0;

/** The reader URL for a stored judgment, at its pinpoint page and paragraph when known. */
export function judgmentHref(
  slug: string,
  judgmentId: string,
  pinpoint: JudgmentPinpoint = {},
): string {
  const query = new URLSearchParams();
  if (positive(pinpoint.page)) query.set('page', String(pinpoint.page));
  if (positive(pinpoint.para)) query.set('para', String(pinpoint.para));
  const search = query.toString();
  const path = `/w/${encodeURIComponent(slug)}/research/judgments/${encodeURIComponent(judgmentId)}`;
  return search === '' ? path : `${path}?${search}`;
}

/** The slug from route params (`useParams()`), or null outside a workspace route. */
export function slugOf(params: unknown): string | null {
  if (params === null || typeof params !== 'object') return null;
  const slug = (params as { slug?: unknown }).slug;
  return typeof slug === 'string' && slug !== '' ? slug : null;
}

/**
 * Whether a stored source URL can be opened in a browser: an archive member (`.tar`, `.zip`, … with
 * or without a `#member`) cannot, and neither can a non-http(s) URL.
 */
export function isBrowsableSourceUrl(url: string | null | undefined): url is string {
  if (url === null || url === undefined || url === '') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  return !/\.(?:tar|tgz|zip|gz|bz2|xz|7z)$/i.test(parsed.pathname);
}
