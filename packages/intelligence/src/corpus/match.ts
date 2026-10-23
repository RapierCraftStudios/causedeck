// The judgment-to-matter matcher (#497, D-048): finds the statute sections a judgment cites in its
// page text and matches them to a matter's confirmed issue tags by normalised statute and section.
// Pure and deterministic; the semantic step (embeddings) is not implemented because
// `judgment.embedding` is empty until a model is chosen. A tag with no section never matches: a
// statute alone would alert on every judgment that mentions the Act.
import { normaliseSection, normaliseStatute, statuteSpellings } from '../issues/index.ts';

export interface MatchablePage {
  pageNo: number;
  text: string;
}

export interface MatchableTag {
  id: string;
  /** Normalised (`normaliseStatute`). */
  statute: string;
  /** Normalised (`normaliseSection`); empty never matches. */
  section: string;
}

export interface TagMatch {
  tagId: string;
  /** The first page the tag's statute and section are cited on. */
  pageNo: number;
  /** The line of the page the citation was found on, trimmed. */
  quote: string;
}

const QUOTE_MAX = 240;
/** Characters after a section number searched for the statute name. */
const STATUTE_WINDOW = 120;

// `section 34`, `s. 34(2)(a)`, `Sections 11 (6)`: the number and its sub-clauses.
const SECTION_REF =
  /\b(?:sections?|secs?\.?|ss?\.)\s*(\d+[a-z]{0,2}(?:\s*\(\s*[0-9a-z]{1,4}\s*\))*)/gi;

function citesStatute(window: string, statute: string): boolean {
  const text = normaliseWindow(window);
  return statuteSpellings(statute).some((spelling) => {
    if (!text.startsWith(spelling)) return false;
    const next = text.charAt(spelling.length);
    return next === '' || next === ' ';
  });
}

/** The words following a section number, without a leading "of", "of the" or "the". */
function normaliseWindow(window: string): string {
  const words = window
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return words.replace(/^(?:of )?(?:the )?/, '');
}

/** True when a cited section covers the tag's: `34(2)(a)` is within `34(2)` and `34`. */
function sectionCovers(tagSection: string, cited: string): boolean {
  return cited === tagSection || cited.startsWith(`${tagSection}(`);
}

/** The tags `pages` cite, each with the first page and line, in tag order. */
export function matchJudgmentToTags(
  pages: readonly MatchablePage[],
  tags: readonly MatchableTag[],
): TagMatch[] {
  const candidates = tags
    .map((tag) => ({
      id: tag.id,
      statute: normaliseStatute(tag.statute),
      section: normaliseSection(tag.section),
    }))
    .filter((tag) => tag.statute !== '' && tag.section !== '');
  const found = new Map<string, TagMatch>();
  for (const page of [...pages].sort((a, b) => a.pageNo - b.pageNo)) {
    for (const line of page.text.split('\n')) {
      for (const ref of line.matchAll(SECTION_REF)) {
        const cited = normaliseSection(ref[1] ?? '');
        const window = line.slice((ref.index ?? 0) + ref[0].length, (ref.index ?? 0) + ref[0].length + STATUTE_WINDOW);
        for (const tag of candidates) {
          if (found.has(tag.id) || !sectionCovers(tag.section, cited)) continue;
          if (!citesStatute(window, tag.statute)) continue;
          found.set(tag.id, {
            tagId: tag.id,
            pageNo: page.pageNo,
            quote: line.trim().slice(0, QUOTE_MAX),
          });
        }
      }
    }
  }
  return candidates.flatMap((tag) => {
    const match = found.get(tag.id);
    return match === undefined ? [] : [match];
  });
}
