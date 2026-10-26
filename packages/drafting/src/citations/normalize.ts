// Canonical forms and name similarity for the citation checker. Pure.
import { STRUCTURED_PATTERNS } from './patterns';

/** Every structured citation in `text`, written canonically, in order of appearance. */
export function normalizedCitationsIn(text: string): string[] {
  const found: { index: number; value: string }[] = [];
  for (const pattern of STRUCTURED_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags))) {
      found.push({ index: match.index, value: pattern.normalize(match as RegExpExecArray) });
    }
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.value);
}

/** The canonical form of the first structured citation in `raw`, or null. */
export function normalizeCitation(raw: string): string | null {
  return normalizedCitationsIn(raw)[0] ?? null;
}

const FILLER = new Set([
  'v',
  'vs',
  'and',
  'the',
  'of',
  'anr',
  'ors',
  'others',
  'another',
  'etc',
  'ltd',
  'limited',
]);

function nameTokens(name: string): Set<string> {
  const tokens = name
    .toLowerCase()
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t !== '' && !FILLER.has(t));
  return new Set(tokens);
}

/** Jaccard similarity of the significant words of two case names, 0 to 1. */
export function titleSimilarity(a: string, b: string): number {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}
