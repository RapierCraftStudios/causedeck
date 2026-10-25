// Language tags from Unicode script ratios (DI-2). Never calls a model: a script count is enough
// to tell English, Tamil and Kannada apart, and an admixture of English (case numbers, statute
// names) tags the text `ta+en` or `kn+en`.
import { addCounts, countScripts, emptyCounts, type ScriptCounts } from './scripts.ts';

export const LANGUAGE_TAGS = ['en', 'ta', 'kn', 'ta+en', 'kn+en'] as const;
export type LanguageTag = (typeof LANGUAGE_TAGS)[number];

/** Fewer script letters than this is too little to tag. */
const MIN_LETTERS = 3;
/** An Indic text with at least this share of Latin letters is mixed. */
const MIXED_LATIN_SHARE = 0.02;
/** A Latin-led text with at least this share of Indic letters is mixed. */
const MIXED_INDIC_SHARE = 0.1;

export function tagFromCounts(counts: ScriptCounts): LanguageTag | null {
  const total = counts.latin + counts.tamil + counts.kannada;
  if (total < MIN_LETTERS) return null;
  const indic: 'ta' | 'kn' = counts.tamil >= counts.kannada ? 'ta' : 'kn';
  const indicCount = indic === 'ta' ? counts.tamil : counts.kannada;
  const mixed: LanguageTag = indic === 'ta' ? 'ta+en' : 'kn+en';
  if (indicCount >= counts.latin) {
    return counts.latin / total >= MIXED_LATIN_SHARE ? mixed : indic;
  }
  return indicCount / total >= MIXED_INDIC_SHARE ? mixed : 'en';
}

export function detectLanguage(text: string): LanguageTag | null {
  return tagFromCounts(countScripts(text));
}

/** The tag of a whole document: the script counts of every page, summed. */
export function detectDocumentLanguage(pageTexts: readonly string[]): LanguageTag | null {
  return tagFromCounts(
    pageTexts.reduce((sum, text) => addCounts(sum, countScripts(text)), emptyCounts()),
  );
}
