// Case citations in a judgment (#894, ADR 0051 §Enrichment): neutral citations (`2024 INSC 123`,
// `2026:MHC:1234`) and reporter citations (`(2005) 6 SCC 1`, `AIR 2010 SC 1234`, `2005 (3) MLJ 45`),
// each parsed to one normalised string. Only the citation string is kept, never reporter text. A
// neutral citation can be resolved to a corpus row; a reporter citation has no row to point at.
import { normaliseNeutralCitation } from '@causedeck/adapters';

export interface CitationPage {
  pageNo: number;
  text: string;
}

export interface CitationRef {
  raw: string;
  normalised: string;
  kind: 'neutral' | 'reporter';
  page: number;
}

const REPORTERS = 'SCC|SCR|SCALE|MLJ|KLJ|CTC';
const COURT_ABBR = '[A-Za-z]{2,4}(?:&[A-Za-z]{1,2})?';

type Parser = { pattern: RegExp; normalise: (m: RegExpExecArray) => string | null };

const PARSERS: readonly Parser[] = [
  {
    // 2024 INSC 123
    pattern: /\b(?:19|20)\d{2}\s+INSC\s+\d{1,6}\b/gi,
    normalise: (m) => normaliseNeutralCitation(m[0]),
  },
  {
    // 2026:MHC:1234, 2026:KHC-D:567
    pattern: /\b(?:19|20)\d{2}\s*:\s*[A-Za-z]{2,6}(?:-[A-Za-z]{1,3})?\s*:\s*\d{1,6}\b/g,
    normalise: (m) => normaliseNeutralCitation(m[0]),
  },
  {
    // (2005) 6 SCC 1
    pattern: new RegExp(`\\(\\s*((?:19|20)\\d{2})\\s*\\)\\s*(\\d{1,3})\\s*(${REPORTERS})\\s*(\\d{1,5})\\b`, 'g'),
    normalise: (m) => `(${m[1]}) ${m[2]} ${m[3]?.toUpperCase()} ${m[4]}`,
  },
  {
    // 2005 (3) MLJ 45
    pattern: new RegExp(`\\b((?:19|20)\\d{2})\\s*\\(\\s*(\\d{1,3})\\s*\\)\\s*(${REPORTERS})\\s*(\\d{1,5})\\b`, 'g'),
    normalise: (m) => `(${m[1]}) ${m[2]} ${m[3]?.toUpperCase()} ${m[4]}`,
  },
  {
    // 2020 SCC OnLine SC 123
    pattern: /\b((?:19|20)\d{2})\s+SCC\s+OnLine\s+([A-Za-z]{2,5})\s+(\d{1,5})\b/g,
    normalise: (m) => `${m[1]} SCC OnLine ${m[2]?.toUpperCase()} ${m[3]}`,
  },
  {
    // AIR 2010 SC 1234
    pattern: new RegExp(`\\bAIR\\s*((?:19|20)\\d{2})\\s+(${COURT_ABBR})\\s*(\\d{1,5})\\b`, 'g'),
    normalise: (m) => `AIR ${m[1]} ${m[2]?.toUpperCase()} ${m[3]}`,
  },
];

/** The citations `pages` cite, once each by normalised form, on the first page that cites them. */
export function extractCitations(pages: readonly CitationPage[]): CitationRef[] {
  const found = new Map<string, CitationRef>();
  for (const page of [...pages].sort((a, b) => a.pageNo - b.pageNo)) {
    for (const { pattern, normalise } of PARSERS) {
      for (const m of page.text.matchAll(pattern)) {
        const normalised = normalise(m);
        if (normalised === null || found.has(normalised)) continue;
        found.set(normalised, {
          raw: m[0].replace(/\s+/g, ' '),
          normalised,
          kind: pattern === PARSERS[0]?.pattern || pattern === PARSERS[1]?.pattern ? 'neutral' : 'reporter',
          page: page.pageNo,
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.page - b.page || a.normalised.localeCompare(b.normalised));
}

/** True for a normalised neutral citation, the only kind a corpus row carries. */
export function isNeutralCitation(normalised: string): boolean {
  return /^\d{4} INSC \d+$/.test(normalised) || /^\d{4}:[A-Z]+(?:-[A-Z]+)?:\d+(?:-(?:DB|FB))?$/.test(normalised);
}
