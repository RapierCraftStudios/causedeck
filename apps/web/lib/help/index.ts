// Help articles (#94): bundled static content, parsed once and searched in the browser, so help
// works offline and no query ever leaves the device (no server search, no query logging).
// Articles live in content/help/*.mdx; content/help/sources.generated.ts embeds them (lib/help/generate.ts).
import { HELP_SOURCES } from '../../content/help/sources.generated.ts';

export const HELP_FOOTER = 'This is software documentation, not legal advice.';

import { HELP_SURFACES, articleSlugForSurface, type HelpSurface } from './surfaces.ts';

export { HELP_SURFACES, type HelpSurface };

export interface HelpArticle {
  slug: string;
  title: string;
  tags: string[];
  surface: HelpSurface;
  updated: string;
  /** Markdown body, footer included. */
  body: string;
}

/** Phrases that read as advice on a case; the content lint (and its test) rejects them. */
export const ADVISORY_PATTERNS: readonly RegExp[] = [
  /\byou (should|must|ought to) (file|appeal|sue|plead|settle|contest)\b/i,
  /\bwe (advise|recommend) (you|that you)\b/i,
  /\b(chances|likelihood) of (success|winning)\b/i,
  /\blikely to (win|succeed|lose)\b/i,
  /\bguaranteed (win|outcome|result)\b/i,
  /\bour legal opinion\b/i,
];

/** Problems with an article: advisory phrasing or a missing footer. Empty means it is clean. */
export function lintArticle(article: Pick<HelpArticle, 'body'>): string[] {
  const problems: string[] = [];
  const text = article.body.trimEnd();
  if (!text.endsWith(HELP_FOOTER)) problems.push('missing footer');
  const withoutFooter = text.endsWith(HELP_FOOTER) ? text.slice(0, -HELP_FOOTER.length) : text;
  for (const pattern of ADVISORY_PATTERNS) {
    if (pattern.test(withoutFooter)) problems.push(`advisory phrase: ${pattern.source}`);
  }
  return problems;
}

/** Parse one `.mdx` source: `---` frontmatter (title, tags, surface, updated) then the body. */
export function parseArticle(slug: string, raw: string): HelpArticle {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(raw);
  if (!match) throw new Error(`Help article ${slug} has no frontmatter`);
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  const surface = meta.surface as HelpSurface;
  if (!meta.title || !meta.updated || !HELP_SURFACES.includes(surface)) {
    throw new Error(`Help article ${slug} has invalid frontmatter`);
  }
  return {
    slug,
    title: meta.title,
    tags: (meta.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    surface,
    updated: meta.updated,
    body: (match[2] ?? '').trim(),
  };
}

const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

export interface HelpIndex {
  articles: HelpArticle[];
  tags: string[];
  /** token -> article index -> weight (title 5, tag 3, body 1). */
  postings: Map<string, Map<number, number>>;
}

/** A small inverted index over title, tags and body. */
export function buildIndex(articles: readonly HelpArticle[]): HelpIndex {
  const postings = new Map<string, Map<number, number>>();
  const add = (text: string, weight: number, at: number) => {
    for (const token of tokenize(text)) {
      const entry = postings.get(token) ?? new Map<number, number>();
      entry.set(at, (entry.get(at) ?? 0) + weight);
      postings.set(token, entry);
    }
  };
  articles.forEach((article, at) => {
    add(article.title, 5, at);
    add(article.tags.join(' '), 3, at);
    add(article.body, 1, at);
  });
  const tags = [...new Set(articles.flatMap((article) => article.tags))].sort();
  return { articles: [...articles], tags, postings };
}

export interface HelpSearchOptions {
  tag?: string | undefined;
  surface?: HelpSurface | undefined;
}

/**
 * Articles matching every query word (a word matches as a prefix), best first, optionally narrowed
 * to a tag or surface. An empty query lists the filtered articles by title.
 */
export function searchHelp(
  index: HelpIndex,
  query: string,
  { tag, surface }: HelpSearchOptions = {},
): HelpArticle[] {
  const words = tokenize(query);
  const allowed = (article: HelpArticle) =>
    (tag === undefined || article.tags.includes(tag)) &&
    (surface === undefined || article.surface === surface);
  if (words.length === 0) {
    return index.articles.filter(allowed).sort((a, b) => a.title.localeCompare(b.title));
  }
  let scores: Map<number, number> | null = null;
  for (const word of words) {
    const wordScores = new Map<number, number>();
    for (const [token, entry] of index.postings) {
      if (!token.startsWith(word)) continue;
      for (const [at, weight] of entry) wordScores.set(at, (wordScores.get(at) ?? 0) + weight);
    }
    if (scores === null) {
      scores = wordScores;
    } else {
      const next = new Map<number, number>();
      for (const [at, score] of scores) {
        const more = wordScores.get(at);
        if (more !== undefined) next.set(at, score + more);
      }
      scores = next;
    }
  }
  return [...(scores ?? [])]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .map(([at]) => index.articles[at] as HelpArticle)
    .filter(allowed);
}

let bundled: HelpIndex | undefined;

/** The bundled articles and their index (built once per runtime). */
export function helpIndex(): HelpIndex {
  bundled ??= buildIndex(
    Object.entries(HELP_SOURCES)
      .map(([slug, raw]) => parseArticle(slug, raw))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );
  return bundled;
}

export function getArticle(slug: string): HelpArticle | undefined {
  return helpIndex().articles.find((article) => article.slug === slug);
}

/** The article that explains a surface (the contextual `?` tip), if any. */
export function articleForSurface(surface: HelpSurface): HelpArticle | undefined {
  return helpIndex().articles.find((article) => article.slug === articleSlugForSurface(surface));
}
