import { describe, expect, it } from 'vitest';

import { matchJudgmentToTags } from './match.ts';

const tag = (id: string, statute: string, section: string) => ({ id, statute, section });
const arb34 = tag('t1', 'arbitration and conciliation act', '34');

describe('matchJudgmentToTags', () => {
  it('matches a section cited with its statute and returns the page and line', () => {
    const pages = [
      { pageNo: 1, text: 'Preamble\nNothing relevant here' },
      {
        pageNo: 3,
        text: 'The petition is filed under Section 34 of the Arbitration and Conciliation Act, 1996.',
      },
    ];
    expect(matchJudgmentToTags(pages, [arb34])).toEqual([
      {
        tagId: 't1',
        pageNo: 3,
        quote: 'The petition is filed under Section 34 of the Arbitration and Conciliation Act, 1996.',
      },
    ]);
  });

  it('reads short spellings of the section and the statute', () => {
    for (const text of [
      's. 34 Arbitration and Conciliation Act',
      'S.34 of the Arbitration & Conciliation Act, 1996',
      'section 34 of the A&C Act',
    ]) {
      expect(matchJudgmentToTags([{ pageNo: 1, text }], [arb34]), text).toHaveLength(1);
    }
  });

  it('matches a sub-section of the tagged section, not the reverse', () => {
    const pages = [{ pageNo: 1, text: 'under Section 34(2)(a) of the Arbitration and Conciliation Act' }];
    expect(matchJudgmentToTags(pages, [arb34])).toHaveLength(1);
    expect(matchJudgmentToTags(pages, [tag('t2', arb34.statute, '34(3)')])).toEqual([]);
    expect(
      matchJudgmentToTags(
        [{ pageNo: 1, text: 'Section 34 of the Arbitration and Conciliation Act' }],
        [tag('t3', arb34.statute, '34(2)')],
      ),
    ).toEqual([]);
  });

  it('does not match the same section of another statute or another section of the statute', () => {
    expect(
      matchJudgmentToTags([{ pageNo: 1, text: 'Section 34 of the Limitation Act, 1963' }], [arb34]),
    ).toEqual([]);
    expect(
      matchJudgmentToTags(
        [{ pageNo: 1, text: 'Section 340 of the Arbitration and Conciliation Act' }],
        [arb34],
      ),
    ).toEqual([]);
  });

  it('never matches a tag without a section', () => {
    const pages = [{ pageNo: 1, text: 'Section 34 of the Arbitration and Conciliation Act' }];
    expect(matchJudgmentToTags(pages, [tag('t4', arb34.statute, '')])).toEqual([]);
  });

  it('keeps the first page when a tag is cited more than once', () => {
    const line = 'Section 11(6) of the Arbitration and Conciliation Act';
    const pages = [
      { pageNo: 5, text: line },
      { pageNo: 2, text: line },
    ];
    expect(matchJudgmentToTags(pages, [tag('t5', arb34.statute, '11(6)')])[0]?.pageNo).toBe(2);
  });
});
