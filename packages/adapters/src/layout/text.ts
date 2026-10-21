// Plain-text layout reader (#370): pasted or forwarded text as a `LayoutDocument`, one page per
// form feed (the split the echo adapter uses for text input). Text has no coordinates.
import type { LayoutDocument } from '../types.ts';

/** Splits `text` into pages on form feeds, with line endings normalised to `\n`. */
export function layoutFromText(text: string): LayoutDocument {
  return {
    pages: text
      .replaceAll(/\r\n?/g, '\n')
      .split('\f')
      .map((pageText, index) => ({
        page: index + 1,
        width: 0,
        height: 0,
        text: pageText,
        items: [],
        words: [],
        textCoverage: pageText.trim() === '' ? 0 : 1,
      })),
  };
}
