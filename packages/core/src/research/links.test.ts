import { describe, expect, it } from 'vitest';

import { buildResearchLinks, researchQueryParts, type ResearchFacts } from './links.ts';
import { BUILT_IN_PROVIDERS, type ResearchProvider } from './providers.ts';
import { researchFactsFromTags } from './notes-service.ts';

const facts: ResearchFacts = {
  statute: 'arbitration and conciliation act',
  section: '34',
  keywords: ['delay in filing'],
  court: 'Madras High Court',
};

describe('buildResearchLinks', () => {
  it('builds one https link per provider with an encoded query', () => {
    const links = buildResearchLinks(facts, BUILT_IN_PROVIDERS);
    expect(links.map((l) => l.providerKey)).toEqual(['indian-kanoon', 'supreme-court', 'high-courts']);
    const kanoon = links[0];
    expect(kanoon?.url).toBe(
      'https://indiankanoon.org/search/?formInput=arbitration%20and%20conciliation%20act%20section%2034%20delay%20in%20filing%20Madras%20High%20Court',
    );
    for (const link of links) {
      expect(link.url.startsWith('https://')).toBe(true);
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
    }
  });

  it('encodes Tamil and Kannada text', () => {
    const tamil = 'மேல்முறையீடு';
    const kannada = 'ಮೇಲ್ಮನವಿ';
    const [link] = buildResearchLinks(
      { ...facts, keywords: [tamil, kannada] },
      BUILT_IN_PROVIDERS.slice(0, 1),
    );
    expect(link?.url).toContain(encodeURIComponent(tamil));
    expect(link?.url).toContain(encodeURIComponent(kannada));
    expect(link?.url).not.toMatch(/[^\x20-\x7e]/);
  });

  it('keeps the query out of the host and out of the path structure', () => {
    const [link] = buildResearchLinks(
      { ...facts, statute: 'x/../@evil.test?#' },
      BUILT_IN_PROVIDERS.slice(0, 1),
    );
    expect(new URL(link?.url ?? '').hostname).toBe('indiankanoon.org');
    expect(link?.url).not.toContain('@evil');
  });

  it('drops a link whose host is not the provider host', () => {
    const rogue: ResearchProvider = {
      key: 'rogue',
      label: 'Rogue',
      urlTemplate: 'https://evil.test/?q={q}',
      host: 'indiankanoon.org',
    };
    const insecure: ResearchProvider = { ...rogue, key: 'http', urlTemplate: 'http://indiankanoon.org/?q={q}' };
    expect(buildResearchLinks(facts, [rogue, insecure])).toEqual([]);
  });

  it('returns no links for empty facts and never puts a matter identifier in a link', () => {
    expect(buildResearchLinks({ statute: '', section: '', keywords: [], court: '' }, BUILT_IN_PROVIDERS)).toEqual([]);
    expect(Object.keys(facts).sort()).toEqual(['court', 'keywords', 'section', 'statute']);
    expect(researchQueryParts(facts)).toHaveLength(4);
  });
});

describe('researchFactsFromTags', () => {
  const tags = [
    { statute: 'ipc', section: '420', issue: 'cheating by a clerk', status: 'confirmed' },
    { statute: 'crpc', section: '482', issue: 'quash', status: 'proposed' },
  ];

  it('gives issue keywords only with strategy access, and only from confirmed tags', () => {
    expect(researchFactsFromTags(tags, 'Delhi High Court', true)).toEqual([
      { statute: 'ipc', section: '420', keywords: ['cheating by a clerk'], court: 'Delhi High Court' },
    ]);
    expect(researchFactsFromTags(tags, 'Delhi High Court', false)).toEqual([
      { statute: 'ipc', section: '420', keywords: [], court: 'Delhi High Court' },
    ]);
  });
});
