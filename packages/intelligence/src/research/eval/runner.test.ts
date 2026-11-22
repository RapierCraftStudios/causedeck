import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
} from '@causedeck/ai';
import { describe, expect, it, assert } from 'vitest';

import { bm25Ranker } from './baseline-ranker.ts';
import { checkAnswer } from './faithfulness.ts';
import { buildManifest, manifestDrift } from './manifest.ts';
import { ndcgAtK, recallAtK } from './metrics.ts';
import { renderJson, renderMarkdown, renderQualityJson, renderQualityMarkdown } from './report.ts';
import {
  buildQualityReport,
  compareQuality,
  compareToBaseline,
  gateQuality,
  loadEvalSet,
  loadPinnedSet,
  QUALITY_SCHEMA_VERSION,
  runEval,
  runSet,
  updateBaseline,
} from './runner.ts';
import { baselineSchema, QUALITY_METRICS, thresholdsSchema, type Ranker } from './types.ts';

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

// #1119: the copilot quality report and gate.
describe('copilot quality report and gate', () => {
  const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
  const PKG = fileURLToPath(new URL('../../../', import.meta.url));
  const mock = createMockEmbedProvider();
  const options = {
    embed: async (texts: readonly string[]) => (await mock.embed(texts)).vectors,
    reranker: createRerankGateway({ providers: [createMockRerankProvider()] }),
  };
  const read = (dir: string, file: string): unknown =>
    JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  const committedBaseline = baselineSchema.parse(read(FIXTURES, 'baseline.json'));
  const thresholds = thresholdsSchema.parse(read(FIXTURES, 'thresholds.json'));
  const copy = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'research-quality-'));
    cpSync(FIXTURES, dir, { recursive: true });
    return dir;
  };

  it('lists every metric for the synthetic and the private set and passes the committed baseline', async () => {
    const report = await buildQualityReport({ ...options, syntheticDir: FIXTURES, privateDir: FIXTURES });
    for (const set of [report.synthetic, report.private]) {
      for (const metric of QUALITY_METRICS) expect(set?.metrics[metric]).toEqual(expect.any(Number));
    }
    expect(report.synthetic.metrics.falseVerified).toBe(0);
    expect(report.schemaVersion).toBe(QUALITY_SCHEMA_VERSION);
    expect(gateQuality(report, committedBaseline, thresholds)).toEqual([]);
    const comparisons = compareQuality(report.synthetic.metrics, committedBaseline, thresholds);
    const json = JSON.parse(renderQualityJson(report, comparisons, [])) as Record<string, unknown>;
    expect(Object.keys(json)[0]).toBe('schemaVersion');
    const md = renderQualityMarkdown(report, comparisons, []);
    for (const label of ['recall@50', 'nDCG@10 (baseline)', 'nDCG@10 (hybrid)', 'Citation accuracy', 'Quote verification rate', 'Pinpoint accuracy', 'False-verified claims', 'Private set (not gated)']) {
      expect(md).toContain(label);
    }
  });

  it('is deterministic on the pinned fixtures', async () => {
    const run = async () => {
      const report = await buildQualityReport({ ...options, syntheticDir: FIXTURES });
      const comparisons = compareQuality(report.synthetic.metrics, committedBaseline, thresholds);
      return renderQualityJson(report, comparisons, gateQuality(report, committedBaseline, thresholds));
    };
    expect(await run()).toBe(await run());
  });

  it('accepts a private gold set without answers.json and never gates on it', async () => {
    const dir = copy();
    rmSync(path.join(dir, 'answers.json'));
    const report = await buildQualityReport({ ...options, syntheticDir: FIXTURES, privateDir: dir });
    expect(report.private?.answers).toBeNull();
    expect(report.private?.metrics.falseVerified).toBeNull();
    // A private set far below the baseline still adds no failure.
    const broken = { ...report, private: { ...report.synthetic, metrics: { ...report.synthetic.metrics, ndcg10: 0, falseVerified: 9 } } };
    expect(gateQuality(broken, committedBaseline, thresholds)).toEqual([]);
  });

  it('fails a regression beyond tolerance naming the metric and passes one within it', () => {
    const m = { ...committedBaseline };
    const at = (patch: Partial<typeof m>) =>
      gateQuality({ synthetic: { metrics: { ...m, ...patch } } } as never, committedBaseline, thresholds);
    expect(at({ ndcg10Hybrid: m.ndcg10Hybrid - 0.019 })).toEqual([]);
    expect(at({ ndcg10Hybrid: m.ndcg10Hybrid - 0.021 })).toEqual([expect.stringMatching(/^ndcg10Hybrid regressed/)]);
    expect(at({ citationAccuracy: 0.99 })).toEqual([expect.stringMatching(/^citationAccuracy regressed/)]);
    expect(at({ pinpointAccuracy: 0.5, recall50: 0.9 })).toEqual([
      expect.stringMatching(/^recall50 regressed/),
      expect.stringMatching(/^pinpointAccuracy regressed/),
    ]);
    expect(at({ quoteVerificationRate: null } as never)).toEqual([expect.stringMatching(/^quoteVerificationRate regressed/)]);
  });

  it('fails any false-verified claim regardless of tolerance', () => {
    const loose = thresholdsSchema.parse(
      Object.fromEntries(QUALITY_METRICS.map((k) => [k, { tolerance: 1e9, direction: 'higher-is-better' }])),
    );
    const report = { synthetic: { metrics: { ...committedBaseline, falseVerified: 1 } } } as never;
    expect(gateQuality(report, committedBaseline, loose)).toEqual([expect.stringMatching(/^falseVerified is 1/)]);
  });

  it('--update-baseline rewrites the baseline and the manifest together', async () => {
    const dir = copy();
    writeFileSync(path.join(dir, 'baseline.json'), '{}\n');
    const answers = read(dir, 'answers.json') as { cases: unknown[] };
    writeFileSync(path.join(dir, 'answers.json'), JSON.stringify({ cases: answers.cases.slice(1) }));
    expect(() => loadPinnedSet(dir)).not.toThrow(); // answers.json is pinned but loaded separately
    expect(manifestDrift(dir, read(dir, 'manifest.json') as Record<string, string>)).toHaveLength(1);
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(buildManifest(dir))}\n`);
    const report = await buildQualityReport({ ...options, syntheticDir: dir });
    const written = updateBaseline(dir, report);
    expect(baselineSchema.parse(read(dir, 'baseline.json'))).toEqual(written);
    expect(Object.keys(read(dir, 'manifest.json') as object)).toEqual(['corpus.json', 'queries.json', 'answers.json']);
    expect(manifestDrift(dir, read(dir, 'manifest.json') as Record<string, string>)).toEqual([]);
  });

  it('the CLI exits 1 naming the regressed metric', () => {
    const dir = copy();
    writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ ...committedBaseline, ndcg10Hybrid: 1.5 }));
    const out = mkdtempSync(path.join(tmpdir(), 'research-quality-out-'));
    const env = { ...process.env, GITHUB_STEP_SUMMARY: path.join(out, 'summary.md') };
    delete env.RESEARCH_EVAL_PRIVATE_DIR;
    const run = spawnSync(path.join(PKG, 'node_modules', '.bin', 'tsx'), ['src/research/eval/cli.ts', '--fixtures', dir, '--out', out], { cwd: PKG, env, encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/research-eval: ndcg10Hybrid regressed/);
    expect(readFileSync(path.join(out, 'summary.md'), 'utf8')).toContain('Gate: **FAILED**');
    expect((JSON.parse(readFileSync(path.join(out, 'report.json'), 'utf8')) as { schemaVersion: number }).schemaVersion).toBe(QUALITY_SCHEMA_VERSION);
  }, 120_000);

  it('the workflow watches the copilot paths, publishes the summary and the artifact, and sets no private dir', () => {
    const workflow = readFileSync(path.join(ROOT, '.github/workflows/research-eval.yml'), 'utf8');
    for (const p of ['packages/core/src/copilot/**', 'packages/ai/src/tasks/answer-*.ts', 'packages/drafting/src/citations/**', 'packages/core/src/citations/**']) {
      expect(workflow).toContain(`- '${p}'`);
    }
    expect(workflow).toContain('actions/upload-artifact');
    expect(workflow).toContain('timeout-minutes: 10');
    expect(workflow).not.toMatch(/RESEARCH_EVAL_PRIVATE_DIR\s*:/);
    expect(readFileSync(path.join(PKG, 'src/research/eval/cli.ts'), 'utf8')).toContain('GITHUB_STEP_SUMMARY');
  });
});
