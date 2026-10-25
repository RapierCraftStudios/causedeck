/** Language tag for user content (documents, party names), wider than the UI locales. */
export const CONTENT_LANGS = ['en', 'ta', 'kn', 'hi', 'other'] as const;

export type ContentLang = (typeof CONTENT_LANGS)[number];

export function isContentLang(value: unknown): value is ContentLang {
  return typeof value === 'string' && (CONTENT_LANGS as readonly string[]).includes(value);
}
