// pnpm --filter @causedeck/intelligence bench:pipeline [--provider auto|mock|real] [--iterations N]
//   [--warmup N] [--audio-dir <dir>] [--out <dir>] [--budget-ms N]
// Runs the pipeline p95 benchmark (#561) and writes report.json and report.md to --out
// (default `pipeline-p95-report`). Exits 1 when the harness or, on real providers, the budget fails.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { BENCH_FIXTURES, type BenchFixture } from './fixtures.ts';
import {
  BUDGET_P95_MS,
  createBenchGateway,
  realCredentials,
  renderMarkdown,
  reportProblems,
  resolveMode,
  runBenchmark,
  type BenchMode,
  type Recording,
} from './pipeline-p95.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const integer = (name: string, fallback: number): number => {
  const value = Number(flag(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a whole number`);
  return value;
};

function fixtureAt(i: number): BenchFixture {
  const fixture = BENCH_FIXTURES[i % BENCH_FIXTURES.length];
  if (fixture === undefined) throw new Error('no bench fixtures');
  return fixture;
}

const MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm',
};

/** Recordings from a directory; durations come from `<file>.json` (`{"durationSeconds": 60}`). */
function loadRecordings(dir: string): Recording[] {
  const files = readdirSync(dir)
    .filter((f) => MIME[path.extname(f).toLowerCase()] !== undefined)
    .sort();
  if (files.length === 0) throw new Error(`no audio files in ${dir}`);
  return files.map((file, i) => {
    const meta = path.join(dir, `${file}.json`);
    let durationSeconds = 60;
    try {
      durationSeconds = (JSON.parse(readFileSync(meta, 'utf8')) as { durationSeconds: number })
        .durationSeconds;
    } catch {
      // No sidecar: assume the 1 minute note the budget is stated for.
    }
    return {
      fixture: fixtureAt(i),
      audio: new Uint8Array(readFileSync(path.join(dir, file))),
      mimeType: MIME[path.extname(file).toLowerCase()] ?? 'audio/wav',
      durationSeconds,
    };
  });
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-process-env -- the provider credentials are the documented opt-in.
  const env = process.env;
  const requested = flag('provider', 'auto');
  if (requested !== 'auto' && requested !== 'mock' && requested !== 'real') {
    throw new Error('--provider must be auto, mock or real');
  }
  const mode: BenchMode = resolveMode(requested, env);
  const audioDir = flag('audio-dir', '');
  const report = await runBenchmark({
    gateway: createBenchGateway(mode, mode === 'real' ? realCredentials(env) : null),
    mode,
    iterations: integer('iterations', mode === 'real' ? 30 : 20),
    warmup: integer('warmup', 1),
    budgetP95Ms: integer('budget-ms', BUDGET_P95_MS),
    ...(audioDir === '' ? {} : { recordings: loadRecordings(audioDir) }),
  });
  const out = path.resolve(flag('out', 'pipeline-p95-report'));
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(out, 'report.md'), renderMarkdown(report));
  process.stdout.write(renderMarkdown(report));
  const problems = reportProblems(report);
  if (problems.length > 0) {
    process.stderr.write(`bench:pipeline: ${problems.join('; ')}\n`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `bench:pipeline: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
