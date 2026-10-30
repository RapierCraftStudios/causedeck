// Segmentation (#893, ADR 0051 §Segments): no loss, page anchors, role boundaries, 300-600 token
// packing, numbered paragraphs and the resolver fallback. Pure, no database.
import { describe, expect, it } from 'vitest';

import { SEGMENT_FIXTURES } from './segment-fixtures.ts';
import {
  estimateTokens,
  fullText,
  MAX_SEGMENT_TOKENS,
  packSegments,
  segmentJudgment,
  segmentJudgmentWithResolver,
  splitParagraphs,
  type RoleResolver,
  type SegmentPage,
} from './segment.ts';

const longPara = (n: number, cue: string) =>
  Array.from({ length: n }, (_, i) => `${cue} sentence number ${String(i)} of the passage.`).join(
    ' ',
  );

describe('segmentJudgment', () => {
  it('loses no text and anchors every segment to a real page, on every fixture', () => {
    for (const j of SEGMENT_FIXTURES) {
      const segments = segmentJudgment(j.pages);
      expect(segments.map((s) => s.text).join(''), j.id).toBe(fullText(j.pages));
      const pageNos = new Set(j.pages.map((p) => p.pageNo));
      for (const s of segments) {
        expect(pageNos.has(s.pageFrom), j.id).toBe(true);
        expect(pageNos.has(s.pageTo), j.id).toBe(true);
        expect(s.pageTo).toBeGreaterThanOrEqual(s.pageFrom);
      }
      expect(segments.map((s) => s.ordinal)).toEqual(segments.map((_, i) => i + 1));
    }
  });

  it('keeps the page range of a paragraph that runs across a page break', () => {
    const pages: SegmentPage[] = [
      { pageNo: 3, text: 'We are of the view that the test is not met. The doctrine cannot' },
      { pageNo: 4, text: 'be extended to this case, and we therefore hold so.' },
    ];
    const [only] = segmentJudgment(pages);
    expect(only).toMatchObject({ role: 'reasoning', pageFrom: 3, pageTo: 4 });
  });

  it("starts a paragraph at each of the court's numbered paragraphs", () => {
    const text = '1. First paragraph about facts filed.\n2. Second paragraph.\n\n3. Third.';
    expect(splitParagraphs(text).map((p) => p.number)).toEqual([1, 2, 3]);
    expect(
      splitParagraphs(text)
        .map((p) => p.text)
        .join(''),
    ).toBe(text);
  });

  it('never crosses a role boundary', () => {
    for (const j of SEGMENT_FIXTURES) {
      const roles = new Set(segmentJudgment(j.pages).map((s) => s.role));
      expect(roles.size).toBeGreaterThan(1);
    }
    const segments = segmentJudgment([
      {
        pageNo: 1,
        text: 'Learned counsel submitted that the order is bad.\n\nIn the result, the appeal is allowed.',
      },
    ]);
    expect(segments.map((s) => s.role)).toEqual(['arguments', 'decision']);
  });

  it('packs same-role paragraphs up to 600 tokens and cuts an oversize paragraph at sentences', () => {
    const body = Array.from(
      { length: 12 },
      (_, i) => `${String(i + 1)}. We are of the view that ${longPara(14, 'reasoning')}`,
    ).join('\n\n');
    const pages = [{ pageNo: 1, text: body }];
    const segments = segmentJudgment(pages);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map((s) => s.text).join('')).toBe(body);
    for (const s of segments.slice(0, -1)) {
      expect(estimateTokens(s.text)).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS);
      expect(estimateTokens(s.text)).toBeGreaterThanOrEqual(300);
    }
    const huge = [{ pageNo: 1, text: `We hold that ${longPara(400, 'huge')}` }];
    const cut = segmentJudgment(huge);
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.map((s) => s.text).join('')).toBe(huge[0]?.text);
    for (const s of cut) expect(estimateTokens(s.text)).toBeLessThanOrEqual(MAX_SEGMENT_TOKENS);
  });

  it('tiles an empty or blank judgment without throwing', () => {
    expect(segmentJudgment([])).toEqual([]);
    const blank = segmentJudgment([{ pageNo: 1, text: '\n\n' }]);
    expect(blank.map((s) => s.text).join('')).toBe('\n\n');
  });

  it('packs segments for given roles', () => {
    const pages = [{ pageNo: 1, text: 'a\n\nb\n\nc' }];
    const segs = packSegments(pages, splitParagraphs('a\n\nb\n\nc'), [
      'facts',
      'facts',
      'decision',
    ]);
    expect(segs.map((s) => [s.role, s.text])).toEqual([
      ['facts', 'a\n\nb\n\n'],
      ['decision', 'c'],
    ]);
  });
});

describe('segmentJudgmentWithResolver', () => {
  const pages = [
    {
      pageNo: 1,
      text: 'IN THE SUPREME COURT\nAppellant versus State\n\nThe weather was fine that day.\n\nIn the result, the appeal is dismissed.',
    },
  ];

  it('asks only about low-confidence paragraphs and applies a valid reply', async () => {
    const asked: number[] = [];
    const resolver: RoleResolver = {
      resolve: (qs) => {
        asked.push(...qs.map((q) => q.index));
        return Promise.resolve({ roles: qs.map((q) => ({ index: q.index, role: 'facts' })) });
      },
    };
    const { segments, asked: n } = await segmentJudgmentWithResolver(pages, resolver);
    expect(n).toBe(asked.length);
    expect(asked).toContain(1);
    expect(segments.map((s) => s.role)).toContain('facts');
    expect(segments.map((s) => s.text).join('')).toBe(fullText(pages));
  });

  it('keeps the rule roles when the reply is invalid or the resolver throws', async () => {
    const rules = segmentJudgment(pages);
    const bad = await segmentJudgmentWithResolver(pages, {
      resolve: () => Promise.resolve({ roles: [{ index: 1, role: 'nonsense' }] }),
    });
    const boom = await segmentJudgmentWithResolver(pages, {
      resolve: () => Promise.reject(new Error('gateway down')),
    });
    expect(bad.segments).toEqual(rules);
    expect(boom.segments).toEqual(rules);
  });
});
