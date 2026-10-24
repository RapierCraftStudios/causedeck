import { describe, expect, it } from 'vitest';

import {
  FUZZY_CONFIDENCE_PENALTY,
  normaliseQuote,
  verifyAnchor,
  type PageText,
} from './anchors.ts';

const pages: PageText[] = [
  {
    pageNo: 1,
    text: 'IN THE HIGH COURT\n  Post   on 12.11.2026\nfor orders.',
    textSource: 'layer',
  },
  { pageNo: 2, text: 'Counter affidavit within two weeks.', textSource: 'layer' },
  {
    pageNo: 3,
    text: 'The respondent shall file counter affidavlt within two weeks from today.',
    textSource: 'ocr',
  },
];

describe('verifyAnchor', () => {
  it('accepts a quote after NFKC and whitespace collapsing, with offsets into the original', () => {
    const result = verifyAnchor({ page: 1, quote: 'Post on 12.11.2026 for orders.' }, pages);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(pages[0]?.text.slice(result.charStart, result.charEnd)).toBe(
        'Post   on 12.11.2026\nfor orders.',
      );
      expect(result.confidencePenalty).toBe(0);
    }
  });

  it('folds compatibility characters (full-width digits, ligatures)', () => {
    const page: PageText[] = [
      { pageNo: 1, text: 'Post on １２.１１.２０２６ ﬁle', textSource: 'layer' },
    ];
    expect(verifyAnchor({ page: 1, quote: 'Post on 12.11.2026 file' }, page).ok).toBe(true);
    expect(normaliseQuote('a  \t b')).toBe('a b');
  });

  it('rejects a quote on the wrong page, an invented quote and an empty quote', () => {
    expect(verifyAnchor({ page: 2, quote: 'Post on 12.11.2026' }, pages)).toEqual({
      ok: false,
      reason: 'quote_not_found',
    });
    expect(verifyAnchor({ page: 1, quote: 'Post on 13.11.2026' }, pages).ok).toBe(false);
    expect(verifyAnchor({ page: 9, quote: 'x' }, pages)).toEqual({
      ok: false,
      reason: 'page_missing',
    });
    expect(verifyAnchor({ page: 1, quote: '   ' }, pages)).toEqual({
      ok: false,
      reason: 'empty_quote',
    });
  });

  it('matches OCR pages fuzzily only when asked, within 3% of the length, at a fixed cost', () => {
    const quote = 'file counter affidavit within two weeks';
    expect(verifyAnchor({ page: 3, quote }, pages).ok).toBe(false);
    expect(verifyAnchor({ page: 3, quote }, pages, { fuzzy: false }).ok).toBe(false);
    const fuzzy = verifyAnchor({ page: 3, quote }, pages, { fuzzy: true });
    expect(fuzzy.ok).toBe(true);
    if (fuzzy.ok) {
      expect(fuzzy.fuzzy).toBe(true);
      expect(fuzzy.confidencePenalty).toBe(FUZZY_CONFIDENCE_PENALTY);
      expect(pages[2]?.text.slice(fuzzy.charStart, fuzzy.charEnd)).toContain('affidavlt');
    }
  });

  it('never matches fuzzily on a text-layer page, or beyond the tolerance', () => {
    expect(
      verifyAnchor({ page: 2, quote: 'Counter affidavlt within two weeks.' }, pages, {
        fuzzy: true,
      }).ok,
    ).toBe(false);
    expect(
      verifyAnchor({ page: 3, quote: 'file counter affidavit within seven months' }, pages, {
        fuzzy: true,
      }).ok,
    ).toBe(false);
  });
});
