// pnpm --filter @causedeck/intelligence research-eval [--out <dir>] [--update-baseline] [--fixtures <dir>]
// The copilot quality gate (#891, #1119, ADR 0051 §Evaluation): retrieval (BM25 and the hybrid on the
// mock embedder and reranker) and the answer verifiers on the committed synthetic set. Writes report.json
// and report.md, prints the Markdown (and appends it to $GITHUB_STEP_SUMMARY), and exits 1 when a gated
// metric regressed beyond fixtures/research-eval/thresholds.json or any claim was false-verified.
// No network, provider or database is used.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createMockEmbedProvider,
  createMockRerankProvider,
  createRerankGateway,
} from '@causedeck/ai';

import { buildManifest } from './manifest.ts';
import { renderQualityJson, renderQualityMarkdown } from './report.ts';
import { buildQualityReport, compareQuality, gateQuality, updateBaseline } from './runner.ts';
import { baselineSchema, thresholdsSchema } from './types.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const FIXTURES = path.resolve(
  option('--fixtures') ??
    fileURLToPath(new URL('../../../../../fixtures/research-eval', import.meta.url)),
);
const outDir = path.resolve(option('--out') ?? 'research-eval-report');
const update = args.includes('--update-baseline');

// A changed fixture is pinned first, so the pinned set loads; the baseline is written with it below.
if (update) {
  writeFileSync(
    path.join(FIXTURES, 'manifest.json'),
    `${JSON.stringify(buildManifest(FIXTURES), null, 2)}\n`,
  );
}

const embedder = createMockEmbedProvider();
// eslint-disable-next-line no-process-env -- the private set path is one optional env var, as documented.
const { RESEARCH_EVAL_PRIVATE_DIR: privateDir, GITHUB_STEP_SUMMARY: summary } = process.env;
const report = await buildQualityReport({
  syntheticDir: FIXTURES,
  privateDir,
  embed: async (texts) => (await embedder.embed(texts)).vectors,
  reranker: createRerankGateway({ providers: [createMockRerankProvider()] }),
});

if (update) updateBaseline(FIXTURES, report);

const read = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES, file), 'utf8'));
const baseline = baselineSchema.parse(read('baseline.json'));
const thresholds = thresholdsSchema.parse(read('thresholds.json'));
const comparisons = compareQuality(report.synthetic.metrics, baseline, thresholds);
const failures = gateQuality(report, baseline, thresholds);
const markdown = renderQualityMarkdown(report, comparisons, failures);

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'report.json'), renderQualityJson(report, comparisons, failures));
writeFileSync(path.join(outDir, 'report.md'), markdown);
process.stdout.write(markdown);
if (summary !== undefined && summary !== '') appendFileSync(summary, markdown);
for (const failure of failures) process.stderr.write(`research-eval: ${failure}\n`);
if (failures.length > 0) process.exitCode = 1;
