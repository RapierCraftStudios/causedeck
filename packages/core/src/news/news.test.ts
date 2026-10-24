import { describe, expect, it } from 'vitest';

import { isNewsDigestTime, newsMatchScore, rankNewsItems } from './index.ts';

const item = (id: string, day: number, tags: { practiceAreas?: string[]; forums?: string[] }) => ({
  id,
  publishedAt: new Date(Date.UTC(2026, 9, day)),
  tags: { practiceAreas: tags.practiceAreas ?? [], forums: tags.forums ?? [] } as never,
});

describe('news ranking', () => {
  const pref = { practiceAreas: ['tax'], forums: ['supreme_court'] } as never;

  it('lists the member’s practice areas and forums first, then newest first (R2)', () => {
    const ranked = rankNewsItems(
      [
        item('new-other', 20, {}),
        item('old-tax', 1, { practiceAreas: ['tax'] }),
        item('old-both', 2, { practiceAreas: ['tax'], forums: ['supreme_court'] }),
        item('mid-other', 10, {}),
      ],
      pref,
    );
    expect(ranked.map((i) => i.id)).toEqual(['old-both', 'old-tax', 'new-other', 'mid-other']);
  });

  it('falls back to recency without preferences', () => {
    const ranked = rankNewsItems([item('a', 1, {}), item('b', 5, {})], null);
    expect(ranked.map((i) => i.id)).toEqual(['b', 'a']);
    expect(newsMatchScore(item('a', 1, {}).tags, null)).toBe(0);
  });

  it('accepts only half-hour digest times', () => {
    expect(isNewsDigestTime('07:30')).toBe(true);
    expect(isNewsDigestTime('07:15')).toBe(false);
    expect(isNewsDigestTime('24:00')).toBe(false);
  });
});
