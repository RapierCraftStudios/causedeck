// Block signatures (#515, D-049): the three ways a source tells a client to go away. A 403 or 429
// status, or a 200 that serves an anti-bot challenge page instead of the content. The check is
// pure and conservative: a court page that merely shows a captcha image is not a block, so only
// the challenge interstitials of the common edge providers count.
export const BLOCK_SIGNATURES = ['http_403', 'http_429', 'challenge_page'] as const;
export type BlockSignature = (typeof BLOCK_SIGNATURES)[number];

/** Challenge interstitials; matched against the start of an HTML body only. */
const CHALLENGE_MARKERS: readonly RegExp[] = [
  /cf-browser-verification|cf-chl-|__cf_chl_/i,
  /checking your browser before accessing/i,
  /<title>\s*just a moment\.\.\.\s*<\/title>/i,
  /_incapsula_resource|incapsula incident id/i,
  /px-captcha|perimeterx/i,
  /verify (that )?you are (a )?human/i,
  /ddos protection by/i,
];

const SCAN_LIMIT = 65_536;

/** The block signature of one response, or `null` when it looks like real content. */
export function detectBlockSignature(
  status: number,
  body: string,
  contentType = 'text/html',
): BlockSignature | null {
  if (status === 403) return 'http_403';
  if (status === 429) return 'http_429';
  if (!/html/i.test(contentType)) return null;
  const head = body.slice(0, SCAN_LIMIT);
  return CHALLENGE_MARKERS.some((marker) => marker.test(head)) ? 'challenge_page' : null;
}
