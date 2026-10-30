// Court-day route bundle budget with a diff report (#105): initial JS of `/w/[slug]/today` at most
// 180 KB gzip. Run after `next build`: `pnpm --filter @causedeck/e2e perf:bundle`. It reuses what
// "initial JS" means from apps/web/scripts/check-bundle-budget.mjs, fails above the budget and prints
// the chunks that grew against e2e/perf/budgets/bundle-budget.json's baseline
// (`--write-baseline` records the current sizes).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// @ts-expect-error -- plain .mjs without types.
import * as web from '../apps/web/scripts/check-bundle-budget.mjs';

const { initialChunks, parseClientReferenceManifest } = web as unknown as {
  initialChunks: (build: unknown, manifest: unknown) => string[];
  parseClientReferenceManifest: (source: string) => unknown;
};

export interface BudgetFile {
  route: string;
  manifest: string;
  budgetBytes: number;
  baseline: Record<string, number>;
}

export interface BundleReport {
  total: number;
  budget: number;
  ok: boolean;
  /** Chunks new or larger than the baseline, biggest growth first. */
  grew: { file: string; before: number; after: number }[];
}

/** Chunk basenames lose their content hash so a rebuilt-but-unchanged chunk matches its baseline. */
export function chunkKey(file: string): string {
  return file.replace(/[-.][0-9a-f]{8,}(?=\.js$)/, '');
}

export function bundleReport(
  sizes: Record<string, number>,
  budget: number,
  baseline: Record<string, number>,
): BundleReport {
  const total = Object.values(sizes).reduce((sum, bytes) => sum + bytes, 0);
  const grew = Object.entries(sizes)
    .map(([file, after]) => ({ file, before: baseline[chunkKey(file)] ?? 0, after }))
    .filter((entry) => entry.after > entry.before)
    .sort((a, b) => b.after - b.before - (a.after - a.before));
  return { total, budget, ok: total <= budget, grew };
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function formatReport(report: BundleReport, hasBaseline: boolean): string {
  const lines = [
    `Court-day initial JS: ${kb(report.total)} gzip (budget ${kb(report.budget)}) ${report.ok ? 'OK' : 'OVER BUDGET'}`,
  ];
  if (hasBaseline) {
    lines.push('Grew since the baseline:');
    for (const { file, before, after } of report.grew)
      lines.push(`  +${kb(after - before).padStart(9)}  ${file} (${kb(before)} -> ${kb(after)})`);
    if (report.grew.length === 0) lines.push('  nothing');
  }
  return lines.join('\n');
}

function main(argv: string[]): number {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const budgetPath = path.join(root, 'e2e/perf/budgets/bundle-budget.json');
  const budgetFile = JSON.parse(readFileSync(budgetPath, 'utf8')) as BudgetFile;
  if (argv.includes('--self-test')) {
    const over = bundleReport({ 'a-0123456789ab.js': 200 * 1024 }, budgetFile.budgetBytes, {});
    const under = bundleReport({ 'a-0123456789ab.js': 1024 }, budgetFile.budgetBytes, {
      'a.js': 1024,
    });
    if (over.ok || !under.ok || under.grew.length !== 0) throw new Error('self-test failed');
    console.log('check-bundle-budget self-test ok');
    return 0;
  }
  const nextDir = path.join(root, 'apps/web/.next');
  const buildManifest: unknown = JSON.parse(
    readFileSync(path.join(nextDir, 'build-manifest.json'), 'utf8'),
  );
  const manifest = parseClientReferenceManifest(
    readFileSync(path.join(nextDir, budgetFile.manifest), 'utf8'),
  );
  const sizes: Record<string, number> = {};
  for (const file of initialChunks(buildManifest, manifest))
    sizes[file] = gzipSync(readFileSync(path.join(nextDir, file))).length;
  const report = bundleReport(sizes, budgetFile.budgetBytes, budgetFile.baseline);
  console.log(formatReport(report, Object.keys(budgetFile.baseline).length > 0));
  if (argv.includes('--write-baseline')) {
    const baseline = Object.fromEntries(Object.entries(sizes).map(([f, b]) => [chunkKey(f), b]));
    writeFileSync(budgetPath, `${JSON.stringify({ ...budgetFile, baseline }, null, 2)}\n`);
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
