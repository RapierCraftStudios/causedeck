// pnpm --filter @causedeck/intelligence research-eval [--out <dir>] [--update-baseline]
// Runs the baseline ranker on the committed synthetic set, writes report.json and report.md, and
// exits 1 when nDCG@10 regressed by more than 2 points against fixtures/research-eval/baseline.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bm25Ranker } from './baseline-ranker.ts';
import { buildManifest } from './manifest.ts';
import { renderJson, renderMarkdown } from './report.ts';
import { compareToBaseline, runEval } from './runner.ts';

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures/research-eval', import.meta.url));
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outDir = path.resolve(
  outIndex >= 0 ? (args[outIndex + 1] ?? 'research-eval-report') : 'research-eval-report',
);
const baselinePath = path.join(FIXTURES, 'baseline.json');

if (args.includes('--update-baseline')) {
  writeFileSync(
    path.join(FIXTURES, 'manifest.json'),
    `${JSON.stringify(buildManifest(FIXTURES), null, 2)}\n`,
  );
}

// eslint-disable-next-line no-process-env -- the private set path is one optional env var, as documented.
const privateDir = process.env.RESEARCH_EVAL_PRIVATE_DIR;
const report = runEval(bm25Ranker(), FIXTURES, privateDir);

if (args.includes('--update-baseline')) {
  const { ndcg10, recall50 } = report.synthetic;
  writeFileSync(baselinePath, `${JSON.stringify({ ndcg10, recall50 }, null, 2)}\n`);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as { ndcg10: number };
const comparison = compareToBaseline(report.synthetic, baseline);
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'report.json'), renderJson(report, comparison));
writeFileSync(path.join(outDir, 'report.md'), renderMarkdown(report, comparison));
process.stdout.write(renderMarkdown(report, comparison));
if (comparison.regressed) {
  process.stderr.write('research-eval: nDCG@10 regressed by more than 2 points\n');
  process.exitCode = 1;
}
