import { describe, expect, it } from 'vitest';

import { FeedFetchFailed, ingestFeed, parseFeed, toExcerpt } from './index.ts';
import type { FeedFetcher } from './index.ts';

const BODY = 'FULL ARTICLE BODY '.repeat(400);

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item>
  <title>Supreme Court &amp; tax appeals</title>
  <link>https://example.test/a</link>
  <pubDate>Mon, 19 Oct 2026 09:00:00 GMT</pubDate>
  <description><![CDATA[<p>Feed <b>excerpt</b> only.</p>]]></description>
  <content:encoded><![CDATA[<p>${BODY}</p>]]></content:encoded>
</item>
<item>
  <title>Second</title>
  <link>https://example.test/a</link>
  <description>duplicate link</description>
</item>
</channel></rss>`;

const fetchSource: FeedFetcher = () =>
  Promise.resolve({
    status: 200,
    body: RSS,
    provenance: { fetchedAt: '2026-10-19T10:00:00.000Z', sha256: 'abc', sourceVersion: 'v1' },
  });

describe('news feed ingestion', () => {
  it('stores only feed-provided fields and never a full article body (R1, R9)', async () => {
    const items = await ingestFeed({
      sourceId: 'news.x',
      feedUrl: 'https://example.test/feed',
      fetchSource,
    });
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.title).toBe('Supreme Court & tax appeals');
    expect(item?.url).toBe('https://example.test/a');
    expect(item?.excerpt).toBe('Feed excerpt only.');
    expect(Object.keys(item ?? {}).sort()).toEqual([
      'excerpt',
      'provenance',
      'publishedAt',
      'sourceId',
      'tags',
      'title',
      'url',
    ]);
    expect(JSON.stringify(items)).not.toContain('FULL ARTICLE BODY');
  });

  it('caps the excerpt and strips markup even when description carries a whole article', () => {
    const entries = parseFeed(
      `<rss><channel><item><title>T</title><link>https://example.test/b</link><description>&lt;p&gt;${BODY}&lt;/p&gt;</description></item></channel></rss>`,
    );
    const excerpt = entries[0]?.excerpt ?? '';
    expect(Array.from(excerpt).length).toBeLessThanOrEqual(500);
    expect(excerpt).not.toContain('<');
    expect(toExcerpt(null)).toBeNull();
  });

  it('keeps the link to the original and the provenance of the fetch (R3)', async () => {
    const [item] = await ingestFeed({
      sourceId: 'news.x',
      feedUrl: 'https://example.test/feed',
      fetchSource,
    });
    expect(item?.url).toBe('https://example.test/a');
    expect(item?.provenance).toEqual({
      sha256: 'abc',
      fetchedAt: new Date('2026-10-19T10:00:00.000Z'),
      sourceVersion: 'v1',
    });
  });

  it('fails on a non-2xx feed answer', async () => {
    const failing: FeedFetcher = () =>
      Promise.resolve({
        status: 503,
        body: '',
        provenance: { fetchedAt: '2026-10-19T10:00:00.000Z', sha256: '', sourceVersion: '' },
      });
    await expect(
      ingestFeed({
        sourceId: 'news.x',
        feedUrl: 'https://example.test/feed',
        fetchSource: failing,
      }),
    ).rejects.toBeInstanceOf(FeedFetchFailed);
  });
});
