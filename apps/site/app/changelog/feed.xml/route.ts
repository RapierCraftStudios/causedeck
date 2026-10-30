import { buildChangelogRss, loadChangelog } from '../../../lib/changelog.ts';
import { canonicalUrl } from '../../../lib/seo.ts';

export const dynamic = 'force-static';

// Static export: the feed is built with the site from content/changelog.
export async function GET(): Promise<Response> {
  const entries = await loadChangelog();
  return new Response(buildChangelogRss(entries, canonicalUrl('changelog')), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
