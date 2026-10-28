// `buildResearchLinks` (#80, D-048): pure. From the statute, section, issue keywords and court the
// lawyer can see, it builds one link per provider. Every part of the query goes through
// `encodeURIComponent` (Tamil and Kannada included); the matter id, CNR and party names are not
// inputs, so they cannot reach a URL. A link whose host is not its provider's host is dropped.
// Links open in a new window (`target="_blank"`, `rel="noopener noreferrer"`); nothing is framed,
// proxied or fetched.
import { QUERY_PLACEHOLDER, type ResearchProvider } from './providers.ts';

export interface ResearchFacts {
  statute: string;
  section: string;
  keywords: string[];
  court: string;
}

export interface ResearchLink {
  providerKey: string;
  label: string;
  url: string;
  host: string;
  target: '_blank';
  rel: 'noopener noreferrer';
}

/** The words of the query, in order: statute, section, keywords, court; empty parts are skipped. */
export function researchQueryParts(facts: ResearchFacts): string[] {
  const section = facts.section.trim();
  return [
    facts.statute,
    section === '' ? '' : `section ${section}`,
    ...facts.keywords,
    facts.court,
  ]
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export function buildResearchLinks(
  facts: ResearchFacts,
  providers: readonly ResearchProvider[],
): ResearchLink[] {
  const parts = researchQueryParts(facts);
  if (parts.length === 0) return [];
  const query = parts.map((part) => encodeURIComponent(part)).join('%20');
  const links: ResearchLink[] = [];
  for (const provider of providers) {
    const url = provider.urlTemplate.split(QUERY_PLACEHOLDER).join(query);
    let host: string;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') continue;
      host = parsed.hostname;
    } catch {
      continue;
    }
    if (host !== provider.host) continue;
    links.push({
      providerKey: provider.key,
      label: provider.label,
      url,
      host,
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  }
  return links;
}
