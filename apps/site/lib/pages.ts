// Slugs owned by dedicated app routes (#91). The `(content)/[...slug]` catch-all and the sitemap
// skip them so each page is rendered, and listed, exactly once.
const OWNED_TOP_LEVEL = ['about', 'security', 'changelog'] as const;

export function isPageOwned(slug: string[]): boolean {
  return (OWNED_TOP_LEVEL as readonly string[]).includes(slug[0] ?? '');
}
