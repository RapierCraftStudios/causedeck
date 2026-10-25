import { siteEnv } from '../../../lib/env.ts';
import { buildRss, loadVerifiedSnapshot } from '../../../lib/status/feed.ts';
import { canonicalUrl } from '../../../lib/seo.ts';

export const dynamic = 'force-static';

// Static export: the feed is rebuilt with the site, from the verified snapshot at build time.
export async function GET(): Promise<Response> {
  const url = siteEnv.statusUrl.startsWith('/')
    ? `${siteEnv.siteUrl}${siteEnv.statusUrl}`
    : siteEnv.statusUrl;
  const snapshot = await loadVerifiedSnapshot(fetch, url, siteEnv.statusVerifyKey);
  return new Response(buildRss(snapshot, canonicalUrl('status')), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
