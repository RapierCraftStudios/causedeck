// Help content and search (#94): at least 15 articles, no advisory phrases, the footer on each,
// fast English search with tag filters, and the bundled sources matching content/help.
import { describe, expect, it } from 'vitest';

import {
  HELP_FOOTER,
  buildIndex,
  getArticle,
  helpIndex,
  lintArticle,
  parseArticle,
  searchHelp,
} from '../../../lib/help/index.ts';
import { renderSources } from '../../../lib/help/generate.ts';
import { HELP_SOURCES } from '../../../content/help/sources.generated.ts';

describe('help articles', () => {
  const { articles } = helpIndex();

  it('ships the required topics, at least 15 articles', () => {
    expect(articles.length).toBeGreaterThanOrEqual(15);
    for (const slug of [
      'first-court-day-view',
      'importing-lists-and-orders',
      'proposals-and-undo',
      'obligations',
      'briefs',
      'memory-review',
      'offline-mode',
      'privacy-and-india-only-ai',
      'clerk-role-limits',
      'export-and-delete',
    ]) {
      expect(getArticle(slug), slug).toBeDefined();
    }
  });

  it('gives no advice and ends each article with the footer', () => {
    for (const article of articles) {
      expect(lintArticle(article), article.slug).toEqual([]);
      expect(article.body.endsWith(HELP_FOOTER), article.slug).toBe(true);
    }
  });

  it('the lint catches advisory phrases and a missing footer', () => {
    expect(lintArticle({ body: `You should file an appeal.\n\n${HELP_FOOTER}` })).toHaveLength(1);
    expect(lintArticle({ body: 'Fine text.' })).toEqual(['missing footer']);
  });

  it('the bundled sources match content/help', () => {
    expect(Object.keys(HELP_SOURCES).length).toBe(articles.length);
    expect(renderSources()).toBe(
      `// Generated from content/help/*.mdx by lib/help/generate.ts. Do not edit.\nexport const HELP_SOURCES: Readonly<Record<string, string>> = {\n${Object.entries(HELP_SOURCES)
        .map(([slug, raw]) => `  ${JSON.stringify(slug)}: ${JSON.stringify(raw)},`)
        .join('\n')}\n};\n`,
    );
  });
});

describe('help search', () => {
  const index = helpIndex();

  it('finds relevant articles for English queries, best first, within 50 ms', () => {
    const started = performance.now();
    const hits = searchHelp(index, 'undo');
    expect(performance.now() - started).toBeLessThan(50);
    expect(hits[0]?.slug).toBe('proposals-and-undo');
    expect(searchHelp(index, 'offli').map((a) => a.slug)).toContain('offline-mode');
  });

  it('narrows by tag and surface and lists everything for an empty query', () => {
    expect(searchHelp(index, '', { tag: 'privacy' }).map((a) => a.slug)).toEqual([
      'privacy-and-india-only-ai',
    ]);
    expect(searchHelp(index, 'a', { surface: 'briefs' }).every((a) => a.surface === 'briefs')).toBe(
      true,
    );
    expect(searchHelp(index, '  ')).toHaveLength(index.articles.length);
    expect(index.tags).toContain('offline');
  });

  it('returns nothing for an unmatched query', () => {
    expect(searchHelp(index, 'zzzzqx')).toEqual([]);
  });

  it('refuses a source without frontmatter', () => {
    expect(() => parseArticle('x', 'no meta')).toThrow('frontmatter');
    expect(buildIndex([]).articles).toEqual([]);
  });
});
