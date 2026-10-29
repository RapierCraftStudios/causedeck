import { siteEnv } from '../../../lib/env.ts';
import { canonicalUrl } from '../../../lib/seo.ts';
import { buildAtom, loadVerifiedSnapshot } from '../../../lib/status/feed.ts';

export const dynamic = 'force-static';

// Static export: rebuilt with the site from the verified snapshot; empty when it is unavailable.
export async function GET(): Promise<Response> {
  const url = siteEnv.statusUrl.startsWith('/')
    ? `${siteEnv.siteUrl}${siteEnv.statusUrl}`
    : siteEnv.statusUrl;
  const snapshot = await loadVerifiedSnapshot(fetch, url, siteEnv.statusVerifyKey);
  return new Response(buildAtom(snapshot, canonicalUrl('status')), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
}
