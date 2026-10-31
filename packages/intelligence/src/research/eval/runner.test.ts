import { mkdtempSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, assert } from 'vitest';

import { bm25Ranker } from './baseline-ranker.ts';
import { checkAnswer } from './faithfulness.ts';
import { manifestDrift } from './manifest.ts';
import { ndcgAtK, recallAtK } from './metrics.ts';
import { renderJson, renderMarkdown } from './report.ts';
import { compareToBaseline, loadEvalSet, loadPinnedSet, runEval, runSet } from './runner.ts';
import type { Ranker } from './types.ts';

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures/research-eval', import.meta.url));
const baseline = JSON.parse(readFileSync(path.join(FIXTURES, 'baseline.json'), 'utf8')) as {
  ndcg10: number;
};

describe('metrics', () => {
  it('scores a perfect ranking 1 and a reversed one lower', () => {
    const judged = { a: 3, b: 2, c: 1 };
    expect(ndcgAtK(['a', 'b', 'c'], judged)).toBeCloseTo(1, 10);
    // DCG = 1/log2(2) + 3/log2(3) + 7/log2(4) over the ideal 7 + 3/log2(3) + 1/log2(4).
    const expected = (1 + 3 / Math.log2(3) + 7 / 2) / (7 + 3 / Math.log2(3) + 0.5);
    expect(ndcgAtK(['c', 'b', 'a'], judged)).toBeCloseTo(expected, 10);
  });

  it('counts only the top k and only grade >= 1 for recall', () => {
    const judged = { a: 3, b: 0, c: 1 };
    expect(recallAtK(['b', 'a', 'x', 'c'], judged, 2)).toBe(0.5);
    expect(recallAtK(['a', 'c'], judged)).toBe(1);
    expect(ndcgAtK(['a'], { a: 0 })).toBe(0);
  });
});

describe('faithfulness', () => {
  const set = loadEvalSet(FIXTURES);
  const segment = set.corpus.judgments.flatMap((j) => j.segments)[0] ?? assert.fail('empty corpus');

  it('accepts a verbatim quote of an existing segment', () => {
    const answer = {
      quotes: [{ judgmentId: 'J01', segmentId: segment.id, text: segment.text.slice(4, 40) }],
    };
    expect(checkAnswer(answer, set.corpus)).toMatchObject({
      quotesMatching: 1,
      citationsExisting: 1,
    });
  });

  it('rejects an altered quote and an unknown or mismatched citation', () => {
    const answer = {
      quotes: [
        { judgmentId: 'J01', segmentId: segment.id, text: 'the patient consented in writing' },
        { judgmentId: 'J01', segmentId: 'nope', text: segment.text },
        { judgmentId: 'J02', segmentId: segment.id, text: segment.text },
      ],
    };
    expect(checkAnswer(answer, set.corpus)).toEqual({
      quotes: 3,
      quotesMatching: 1,
      citations: 3,
      citationsExisting: 1,
    });
  });
});

describe('pinned synthetic set', () => {
  it('has about 15 queries over the fixture corpus', () => {
    expect(loadPinnedSet(FIXTURES).queries.length).toBeGreaterThanOrEqual(15);
  });

  it('refuses a corpus file that no longer matches the manifest', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'research-eval-'));
    cpSync(FIXTURES, dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'corpus.json'),
      `${readFileSync(path.join(dir, 'corpus.json'), 'utf8')} `,
    );
    const pinned = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Record<
      string,
      string
    >;
    expect(manifestDrift(dir, pinned)).toHaveLength(1);
    expect(() => loadPinnedSet(dir)).toThrow(/drifted/);
  });
});

describe('runner and reports', () => {
  it('meets the committed baseline with full faithfulness and writes both reports', () => {
    const report = runEval(bm25Ranker(), FIXTURES, undefined);
    expect(report.private).toBeNull();
    expect(report.synthetic.quoteFaithfulness).toBe(1);
    expect(report.synthetic.citationFaithfulness).toBe(1);
    const comparison = compareToBaseline(report.synthetic, baseline);
    expect(comparison.regressed).toBe(false);
    const parsed = JSON.parse(renderJson(report, comparison)) as { synthetic: { queries: number } };
    expect(parsed.synthetic.queries).toBe(report.synthetic.queries);
    expect(renderMarkdown(report, comparison)).toContain('| nDCG@10 |');
  });

  it('reports a private set separately from the gated synthetic one', () => {
    const report = runEval(bm25Ranker(), FIXTURES, FIXTURES);
    expect(report.private?.queries).toBe(report.synthetic.queries);
    expect(renderMarkdown(report, null)).toContain('Private set (not gated)');
  });

  // The integration check behind the research-eval job: an injected ranking regression must fail it.
  it('fails the baseline comparison on an injected ranking regression', () => {
    const good = bm25Ranker();
    const broken: Ranker = { ...good, name: 'broken', rank: (q, c) => good.rank(q, c).reverse() };
    const comparison = compareToBaseline(runSet(broken, loadPinnedSet(FIXTURES)), baseline);
    expect(comparison.regressed).toBe(true);
  });

  it('tolerates a drop of up to 2 nDCG points and fails beyond', () => {
    const at = (ndcg10: number) => compareToBaseline({ ndcg10 } as never, { ndcg10: 0.9 });
    expect(at(0.88).regressed).toBe(false);
    expect(at(0.879).regressed).toBe(true);
  });
});
