// Anchor verification (#46): a quote is real only if it occurs, after NFKC normalisation and
// whitespace collapsing, in the page it cites. Offsets are mapped back to the *original* page
// text, so `charStart`/`charEnd` slice the stored page. The optional fuzzy mode (Levenshtein <= 3%
// of the quote's length) is for OCR pages only and costs a fixed amount of confidence.

export interface PageText {
  pageNo: number;
  text: string;
  /** `ocr` pages may be matched fuzzily when the caller opts in. */
  textSource: 'layer' | 'ocr' | null;
}

export interface AnchorCheck {
  documentId: string;
  page: number;
  quote: string;
  charStart: number;
  charEnd: number;
}

export type AnchorFailure = 'page_missing' | 'empty_quote' | 'quote_not_found';

export type AnchorResult =
  | {
      ok: true;
      charStart: number;
      charEnd: number;
      fuzzy: boolean;
      /** Subtract from the field's confidence: 0 for an exact match. */
      confidencePenalty: number;
    }
  | { ok: false; reason: AnchorFailure };

/** What a fuzzy (OCR) match costs in confidence. */
export const FUZZY_CONFIDENCE_PENALTY = 0.15;
/** The Levenshtein budget as a share of the quote's length. */
export const FUZZY_TOLERANCE = 0.03;

interface Normalised {
  text: string;
  /** For each normalised character, the original `[start, end)` it came from. */
  starts: number[];
  ends: number[];
}

/** NFKC per code point, runs of whitespace collapsed to one space, trimmed; with an offset map. */
export function normaliseWithMap(original: string): Normalised {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const cp of original) {
    const start = index;
    index += cp.length;
    for (const ch of cp.normalize('NFKC')) {
      const space = /\s/u.test(ch);
      if (space && (chars.length === 0 || chars[chars.length - 1] === ' ')) {
        // Fold into the previous space so its range covers the whole run.
        if (chars.length > 0) ends[ends.length - 1] = index;
        continue;
      }
      chars.push(space ? ' ' : ch);
      starts.push(start);
      ends.push(index);
    }
  }
  while (chars[chars.length - 1] === ' ') {
    chars.pop();
    starts.pop();
    ends.pop();
  }
  return { text: chars.join(''), starts, ends };
}

/** `text` with NFKC applied and whitespace collapsed (no map). */
export function normaliseQuote(text: string): string {
  return normaliseWithMap(text).text;
}

/**
 * Approximate substring match (Sellers): the first end position where `pattern` matches a
 * substring of `text` within `maxDist` edits, with the smallest distance there.
 */
function approxEnd(text: string, pattern: string, maxDist: number): number | null {
  const m = pattern.length;
  let column = Array.from({ length: m + 1 }, (_, i) => i);
  let best: { end: number; dist: number } | null = null;
  for (let j = 1; j <= text.length; j++) {
    const next = new Array<number>(m + 1);
    next[0] = 0;
    for (let i = 1; i <= m; i++) {
      const cost = pattern[i - 1] === text[j - 1] ? 0 : 1;
      next[i] = Math.min((column[i - 1] ?? 0) + cost, (column[i] ?? 0) + 1, (next[i - 1] ?? 0) + 1);
    }
    const dist = next[m] ?? Infinity;
    if (dist <= maxDist && (best === null || dist < best.dist)) best = { end: j, dist };
    column = next;
  }
  return best === null ? null : best.end;
}

const reverse = (s: string): string => Array.from(s).reverse().join('');

/** The `[start, end)` of `quote` in `text` within the Levenshtein budget, or null. */
function fuzzyFind(text: string, quote: string): [number, number] | null {
  const budget = Math.floor(quote.length * FUZZY_TOLERANCE);
  const end = approxEnd(text, quote, budget);
  if (end === null) return null;
  const back = approxEnd(reverse(text.slice(0, end)), reverse(quote), budget);
  if (back === null) return null;
  return [Math.max(0, end - back), end];
}

export function verifyAnchor(
  check: Pick<AnchorCheck, 'page' | 'quote'>,
  pages: readonly PageText[],
  options: { fuzzy?: boolean } = {},
): AnchorResult {
  const page = pages.find((p) => p.pageNo === check.page);
  if (page === undefined) return { ok: false, reason: 'page_missing' };
  const quote = normaliseQuote(check.quote);
  if (quote.length === 0) return { ok: false, reason: 'empty_quote' };
  const haystack = normaliseWithMap(page.text);
  const at = haystack.text.indexOf(quote);
  if (at >= 0) {
    return {
      ok: true,
      charStart: haystack.starts[at] ?? 0,
      charEnd: haystack.ends[at + quote.length - 1] ?? page.text.length,
      fuzzy: false,
      confidencePenalty: 0,
    };
  }
  if (options.fuzzy === true && page.textSource === 'ocr') {
    const hit = fuzzyFind(haystack.text, quote);
    if (hit !== null && hit[1] > hit[0]) {
      return {
        ok: true,
        charStart: haystack.starts[hit[0]] ?? 0,
        charEnd: haystack.ends[hit[1] - 1] ?? page.text.length,
        fuzzy: true,
        confidencePenalty: FUZZY_CONFIDENCE_PENALTY,
      };
    }
  }
  return { ok: false, reason: 'quote_not_found' };
}
