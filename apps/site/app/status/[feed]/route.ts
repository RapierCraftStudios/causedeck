import { siteEnv } from '../../../lib/env.ts';
import { buildAtom, buildRss, loadVerifiedSnapshot } from '../../../lib/status/feed.ts';
import { canonicalUrl } from '../../../lib/seo.ts';

export const dynamic = 'force-static';
export const dynamicParams = false;

const FEEDS = {
  'feed.xml': { build: buildRss, type: 'application/rss+xml' },
  'atom.xml': { build: buildAtom, type: 'application/atom+xml' },
} as const;

export function generateStaticParams(): { feed: string }[] {
  return Object.keys(FEEDS).map((feed) => ({ feed }));
}

// Static export: the feeds are rebuilt with the site, from the verified snapshot at build time.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ feed: string }> },
): Promise<Response> {
  const { feed } = await params;
  const entry = (FEEDS as Record<string, (typeof FEEDS)[keyof typeof FEEDS] | undefined>)[feed];
  if (!entry) return new Response('Not found', { status: 404 });
  const url = siteEnv.statusUrl.startsWith('/')
    ? `${siteEnv.siteUrl}${siteEnv.statusUrl}`
    : siteEnv.statusUrl;
  const snapshot = await loadVerifiedSnapshot(fetch, url, siteEnv.statusVerifyKey);
  return new Response(entry.build(snapshot, canonicalUrl('status')), {
    headers: { 'Content-Type': `${entry.type}; charset=utf-8` },
  });
}
