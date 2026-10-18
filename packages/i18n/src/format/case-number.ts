// Case numbers, party names, citations and uploaded document text are user content: the UI never
// translates, transliterates or localises their digits. These helpers return the text unchanged
// with the `lang` attribute to render it with, so screen readers switch voice for mixed content.
import type { ContentLang } from '../content-lang';

export interface TaggedContent {
  text: string;
  /** Value for the HTML `lang` attribute; `undefined` (omit it) when the language is unknown. */
  lang: string | undefined;
}

export function langAttribute(lang: ContentLang): string | undefined {
  return lang === 'other' ? undefined : lang;
}

export function tagContent(text: string, lang: ContentLang): TaggedContent {
  return { text, lang: langAttribute(lang) };
}

/** A case number exactly as filed (only surrounding whitespace is trimmed). */
export function formatCaseNumber(value: string, lang: ContentLang = 'en'): TaggedContent {
  return tagContent(value.trim(), lang);
}
