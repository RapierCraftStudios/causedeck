// Text quality gates of the HF import (#1171): a normalised text hash, the dedupe key for texts the
// dataset repeats under different CNRs, and a floor that drops rows whose extracted text is too short,
// stuttering ("IN IN IN THE HIGH COURT") or mostly non-words. Pure functions; the importer counts
// every drop by reason.
import { createHash } from 'node:crypto';

/** Texts shorter than this (after whitespace collapse) are dropped as `short`. */
export const HF_MIN_TEXT_CHARS = 200;
/** Share of tokens equal to the one before them above which a text is dropped as `repeated`. */
export const HF_MAX_REPEAT_RATIO = 0.15;
/** Share of tokens that read as words below which a text is dropped as `garbled`. */
export const HF_MIN_WORD_RATIO = 0.5;
/** Share of distinct tokens below which a long text (one phrase looped) is dropped as `repeated`. */
export const HF_MIN_DISTINCT_RATIO = 0.05;
const DISTINCT_CHECK_TOKENS = 400;

export type HfQualityDrop = 'short' | 'repeated' | 'garbled';

/** Unicode-normalised, lower-cased, punctuation-free, whitespace-collapsed text. */
export function normaliseHashText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** sha256 hex of `normaliseHashText(text)`: equal for texts that differ only in case, spacing or punctuation. */
export function textHash(text: string): string {
  return createHash('sha256').update(normaliseHashText(text)).digest('hex');
}

// A word: letters (any script, with combining marks), optionally joined by an apostrophe or hyphen,
// or a number. Abbreviations ("u/s", "s.302") reduce to these after punctuation is dropped.
const WORD_RE = /^(?:[\p{L}\p{M}]{2,}(?:['’-][\p{L}\p{M}]+)*|\p{N}+|[aio])$/iu;

/** Why the text is below the quality floor, or null when it is usable. */
export function qualityDrop(text: string): HfQualityDrop | null {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length < HF_MIN_TEXT_CHARS) return 'short';
  const tokens = normaliseHashText(text).split(' ').filter(Boolean);
  if (tokens.length === 0) return 'garbled';
  let repeats = 0;
  for (let i = 1; i < tokens.length; i += 1) if (tokens[i] === tokens[i - 1]) repeats += 1;
  if (repeats / tokens.length > HF_MAX_REPEAT_RATIO) return 'repeated';
  if (
    tokens.length >= DISTINCT_CHECK_TOKENS &&
    new Set(tokens).size / tokens.length < HF_MIN_DISTINCT_RATIO
  )
    return 'repeated';
  // Words are judged on the raw tokens, so symbol soup that normalises away still counts against it.
  const raw = collapsed.split(' ');
  const words = raw.filter((t) => WORD_RE.test(t.replace(/^[("'“‘[]+|[)"'”’\].,;:!?]+$/g, '')));
  if (words.length / raw.length < HF_MIN_WORD_RATIO) return 'garbled';
  return null;
}
