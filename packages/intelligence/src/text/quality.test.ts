import { describe, expect, it } from 'vitest';

import { LEGACY_KANNADA_TEXT } from '../synthetic/make-docs.ts';
import { coverage, DEFAULT_MIN_PAGE_CHARS, isGarbled, normaliseText } from './quality.ts';

describe('text quality', () => {
  it('normalises whitespace and counts coverage after normalisation', () => {
    expect(normaliseText('  a   b \n\n\n\n c  ')).toBe('a b\n\nc');
    expect(coverage(' x      y ')).toBe(3);
    expect(DEFAULT_MIN_PAGE_CHARS).toBe(40);
  });

  it('flags a legacy-font (Nudi/Baraha-style) Kannada layer as garbled', () => {
    expect(isGarbled(LEGACY_KANNADA_TEXT, { languageHint: 'kn' })).toBe(true);
    expect(isGarbled(LEGACY_KANNADA_TEXT)).toBe(true);
  });

  it('flags private-use glyph runs', () => {
    expect(isGarbled('  abc')).toBe(true);
  });

  it('flags a Kannada-hinted page whose code points are outside U+0C80-U+0CFF', () => {
    expect(isGarbled('1234567890 -- ~~~ ## 1234567890 ## ~~~', { languageHint: 'kn' })).toBe(true);
  });

  it('accepts sound English, Tamil and Kannada text', () => {
    expect(isGarbled('The respondent shall file a counter on the next date of hearing.')).toBe(
      false,
    );
    expect(isGarbled('ಪ್ರತಿವಾದಿಯು ಉತ್ತರ ಸಲ್ಲಿಸಬೇಕು ಅರ್ಜಿ ವಿಚಾರಣೆ', { languageHint: 'kn' })).toBe(
      false,
    );
    expect(
      isGarbled('எதிர்மனுதாரர் பதில் மனுவை தாக்கல் செய்ய வேண்டும்', { languageHint: 'ta' }),
    ).toBe(false);
  });

  it('lets English text through on a Kannada-hinted page', () => {
    expect(
      isGarbled('The respondent shall file the counter and the order of the court is final.', {
        languageHint: 'kn',
      }),
    ).toBe(false);
  });
});
