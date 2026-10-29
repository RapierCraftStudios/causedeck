import { loadLegalPage, renderFeed, subprocessorFeedItems } from '../../../../lib/legal.ts';

export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const page = await loadLegalPage('sub-processors');
  const xml = renderFeed(subprocessorFeedItems(page.legal.history));
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
}
