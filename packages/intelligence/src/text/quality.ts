// Page-text quality: normalisation, coverage and the garbled / legacy-font check (DI-1).
// Older Kannada scans often carry text in non-Unicode fonts (Nudi, Baraha): the extracted code
// points are Latin-1 or private-use gibberish while the page image reads fine. Such a layer is
// unusable and its page is re-routed to OCR rather than guessed at.
import { KANNADA_RANGE, TAMIL_RANGE } from '../language/scripts.ts';

/** Pages with fewer normalised characters than this have no usable text layer. */
export const DEFAULT_MIN_PAGE_CHARS = 40;

/** NFC, collapsed whitespace, trimmed. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Characters on a page after normalisation. */
export function coverage(text: string): number {
  return normaliseText(text).length;
}

const ENGLISH_WORDS = new Set(
  (
    'the of and to in is for that on with be by this as at are was it from or an not shall will ' +
    'order court petition respondent petitioner counsel hon ble case date judgment learned'
  ).split(' '),
);

/** Share of the page's Latin words that are common English words. */
export function englishWordShare(text: string): number {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.length === 0) return 0;
  return words.filter((word) => ENGLISH_WORDS.has(word)).length / words.length;
}

export interface GarbledOptions {
  /** The language the forum or capture says the page is in. */
  languageHint?: 'en' | 'ta' | 'kn' | null | undefined;
  /**
   * Whether the page image is non-empty. A page with text-layer glyphs always draws something, so
   * the pipeline passes `true` unless it knows the page is blank.
   */
  imageNonEmpty?: boolean;
}

const MIN_LETTERS = 8;
const PUA_SHARE = 0.1;
const LATIN1_SYMBOL_SHARE = 0.25;
const MIN_INDIC_SHARE = 0.1;
const ENGLISH_ESCAPE_SHARE = 0.2;

function isPrivateUseOrBroken(cp: number): boolean {
  return (
    (cp >= 0xe000 && cp <= 0xf8ff) ||
    cp === 0xfffd ||
    (cp < 0x20 && cp !== 0x0a && cp !== 0x09) ||
    (cp >= 0x7f && cp <= 0x9f)
  );
}

/** Latin-1 supplement letters and symbols (U+00A1-U+00FF): what a legacy Indic mapping lands on. */
function isLatin1High(cp: number): boolean {
  return cp >= 0xa1 && cp <= 0xff;
}

/**
 * Whether a text-layer page is unusable: a high share of private-use or replacement glyphs, a high
 * share of Latin-1 symbol letters, or a page hinted Kannada (or Tamil) whose code points sit
 * outside that script's block while the page image is non-empty and the text is not English.
 */
export function isGarbled(text: string, options: GarbledOptions = {}): boolean {
  const chars = Array.from(text.replace(/\s+/g, ''));
  if (chars.length < MIN_LETTERS) return false;
  let broken = 0;
  let latin1 = 0;
  let kannada = 0;
  let tamil = 0;
  for (const char of chars) {
    const cp = char.codePointAt(0) ?? 0;
    if (isPrivateUseOrBroken(cp)) broken += 1;
    else if (isLatin1High(cp)) latin1 += 1;
    if (cp >= KANNADA_RANGE[0] && cp <= KANNADA_RANGE[1]) kannada += 1;
    if (cp >= TAMIL_RANGE[0] && cp <= TAMIL_RANGE[1]) tamil += 1;
  }
  if (broken / chars.length >= PUA_SHARE) return true;
  if (latin1 / chars.length >= LATIN1_SYMBOL_SHARE) return true;

  const hint = options.languageHint;
  if ((hint === 'kn' || hint === 'ta') && (options.imageNonEmpty ?? true)) {
    const indicShare = (hint === 'kn' ? kannada : tamil) / chars.length;
    if (indicShare < MIN_INDIC_SHARE && englishWordShare(text) < ENGLISH_ESCAPE_SHARE) return true;
  }
  return false;
}
