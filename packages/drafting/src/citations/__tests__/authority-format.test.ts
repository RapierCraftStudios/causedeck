// #1142: the canonical authority paragraph reads back through the citation extractor with the same
// citation, pinpoint, quote and title hint, so `checkDraft` can check what was inserted.
import { describe, expect, it } from 'vitest';

import { formatAuthorityParagraph, type AuthorityParagraphInput } from '../../authority-format';
import { extractCitations, extractFromText } from '../extract';

const structured = (text: string) =>
  extractFromText(text, 'b').filter((i) => i.kind !== 'case_name');

/** The normalized form the extractor gives the bare citation. */
const normalizedOf = (citation: string) => structured(citation)[0]?.normalized;

describe('formatAuthorityParagraph round trip', () => {
  it.each([
    ['2023 INSC 123', { para: 12 }],
    ['2026:MHC:123', { para: 4, paraEnd: 6 }],
    ['W.P. No. 1 of 2024', { page: 7 }],
  ] as const)('%s with %o', (citation, pin) => {
    const input: AuthorityParagraphInput = {
      quote: 'no written consent was taken',
      title: 'X v. State',
      citation,
      ...pin,
    };
    const text = formatAuthorityParagraph(input);
    const items = structured(text);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      normalized: normalizedOf(citation),
      pinpoint: pin,
      quote: 'no written consent was taken',
      titleHint: 'X v. State',
    });
    // The title is the citation's hint, not a case name of its own.
    expect(extractFromText(text, 'b').filter((i) => i.kind === 'case_name')).toEqual([]);
  });

  it('writes the issue form', () => {
    expect(
      formatAuthorityParagraph({
        quote: '  the  facts ',
        title: 'X v. State',
        citation: '2026:MHC:9',
        para: 3,
      }),
    ).toBe('"the facts" — X v. State, 2026:MHC:9, para 3');
  });

  it('works with no title', () => {
    const text = formatAuthorityParagraph({ quote: 'the facts', citation: '2023 INSC 5', para: 2 });
    expect(text).toBe('"the facts" — 2023 INSC 5, para 2');
    const [item] = structured(text);
    expect(item).toMatchObject({
      normalized: '2023 INSC 5',
      pinpoint: { para: 2 },
      quote: 'the facts',
    });
    expect(item?.titleHint).toBeUndefined();
  });

  it('round-trips a quote naming another case or holding straight quotes', () => {
    const named = formatAuthorityParagraph({
      quote: 'as held in Ramesh v. Union the rule applies',
      title: 'X v. State',
      citation: '2023 INSC 123',
      para: 1,
    });
    expect(structured(named)[0]).toMatchObject({
      normalized: '2023 INSC 123',
      quote: 'as held in Ramesh v. Union the rule applies',
      titleHint: 'X v. State',
    });

    const quoted = formatAuthorityParagraph({
      quote: 'the word "shall" is mandatory',
      title: 'X v. State',
      citation: '2023 INSC 123',
      para: 1,
    });
    expect(quoted).toBe('"the word “shall” is mandatory" — X v. State, 2023 INSC 123, para 1');
    expect(structured(quoted)[0]?.quote).toBe('the word “shall” is mandatory');
  });

  it('keeps a trailing quote ahead of a leading one', () => {
    const [item] = structured('"before" — X v. State, 2023 INSC 123, para 2, "after"');
    expect(item?.quote).toBe('after');
  });

  it('reads the paragraph through extractCitations with the block id', () => {
    const text = formatAuthorityParagraph({
      quote: 'the facts',
      title: 'X v. State',
      citation: '2026:MHC:77',
      para: 1,
    });
    const items = extractCitations([{ type: 'paragraph', id: 'auth-1', text }]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      blockId: 'auth-1',
      quote: 'the facts',
      pinpoint: { para: 1 },
    });
  });

  it('attaches no quote that is not set off by a dash', () => {
    expect(structured('He said "hello" in 2023 INSC 123')[0]?.quote).toBeUndefined();
  });
});
