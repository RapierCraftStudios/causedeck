// Usage: pnpm --filter @causedeck/fetch captcha:accuracy -- [--dir <set>] [--engine mock|<module path>]
//        [--min <0..1>] [--min-confidence <0..1>] [--case-sensitive]
// Measures first-try accuracy of a local solver over a labelled directory (see src/captcha/accuracy.ts).
// Default: the synthetic sample with the mock engine. A real engine is a module whose default export
// is an `OcrEngine` ({ recognize(image) }). Exits 1 when accuracy is below `--min`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadLabelledSet, measureAccuracy } from '../src/captcha/accuracy.ts';
import { createLocalSolver, type OcrEngine } from '../src/captcha/solver.ts';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const dir = path.resolve(
  flag('--dir') ?? path.join(import.meta.dirname, '../fixtures/synthetic-captchas'),
);
const engineArg = flag('--engine') ?? 'mock';
const min = flag('--min') === undefined ? null : Number(flag('--min'));
const minConfidence =
  flag('--min-confidence') === undefined ? undefined : Number(flag('--min-confidence'));

async function loadEngine(): Promise<OcrEngine> {
  if (engineArg === 'mock') {
    // The synthetic sample's "images" are text payloads: `SYNTHETIC-CAPTCHA\n<rendered text>`.
    return {
      recognize(image) {
        const [header, rendered] = Buffer.from(image).toString('utf8').split('\n');
        if (header !== 'SYNTHETIC-CAPTCHA' || rendered === undefined || rendered === '') {
          return Promise.resolve(null);
        }
        return Promise.resolve({ text: rendered, confidence: 0.9 });
      },
    };
  }
  const mod = (await import(pathToFileURL(path.resolve(engineArg)).href)) as { default: OcrEngine };
  return mod.default;
}

const samples = loadLabelledSet(dir);
const solver = createLocalSolver(
  await loadEngine(),
  minConfidence === undefined ? {} : { minConfidence },
);
const report = await measureAccuracy(samples, solver, {
  caseSensitive: args.includes('--case-sensitive'),
});

console.log(JSON.stringify({ dir, engine: engineArg, ...report }, null, 2));
console.log(
  `First-try accuracy: ${(report.firstTryAccuracy * 100).toFixed(1)}% (${String(report.correct)}/${String(report.total)})`,
);
if (report.total < 500)
  console.warn('Note: fewer than 500 samples; this is not the real accuracy measurement.');
if (min !== null && report.firstTryAccuracy < min) process.exit(1);
