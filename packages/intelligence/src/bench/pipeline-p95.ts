// Pipeline p95 benchmark (#561). Drives the voice-note capture path through the AI gateway:
//   recording -> `transcribe` (Sarvam) -> `structure_hearing` (Bedrock) -> matter match -> drafts
// for N iterations over the synthetic fixtures and reports end-to-end and per-stage p50/p95/p99.
// Budget: p95 end-to-end under 20 s for a 1 minute note (backlog E2-4). Mock providers by default
// (nothing leaves the process); real providers only when the credentials env is complete and the
// caller did not force `mock`. Runbook: docs/benchmarks/pipeline-p95.md.
import {
  createBedrockProvider,
  createGateway,
  createMockProvider,
  createSarvamProvider,
  type AiGateway,
  type GatewayPorts,
  type Provider,
} from '@causedeck/ai';

import { rankMatters } from '../structure/match-matter.ts';
import { structureHearing } from '../structure/hearing.ts';
import { hearingToProposalDrafts } from '../structure/to-proposals.ts';
import { createGatewayTranscribe } from '../transcribe/transcribe.ts';
import { BENCH_FIXTURES, syntheticWav, type BenchFixture } from './fixtures.ts';
import { summarise, type LatencySummary } from './stats.ts';

export const BUDGET_P95_MS = 20_000;
export const NOTE_SECONDS = 60;
const WORKSPACE = '00000000-0000-4000-8000-000000000561';
const PIPELINE_VERSION = 'bench.v1';

export type BenchMode = 'mock' | 'real';
export const STAGES = ['transcribe', 'structure', 'match_and_draft'] as const;
export type Stage = (typeof STAGES)[number];

export interface RealCredentials {
  bedrock: { region: string; accessKeyId: string; secretAccessKey: string; modelId: string };
  sarvamApiKey: string;
}

type Env = Readonly<Record<string, string | undefined>>;

/** The env variables a real run needs and does not have; empty when it can run. */
export function missingRealCredentials(env: Env): string[] {
  const need = [
    'BEDROCK_REGION',
    'BEDROCK_ACCESS_KEY_ID',
    'BEDROCK_SECRET_ACCESS_KEY',
    'BEDROCK_MODEL_ID',
    'SARVAM_API_KEY',
  ];
  const missing = need.filter((k) => (env[k] ?? '') === '');
  if (env['SARVAM_NO_TRAINING_CONFIRMED'] !== 'true') missing.push('SARVAM_NO_TRAINING_CONFIRMED');
  return missing;
}

export function realCredentials(env: Env): RealCredentials | null {
  if (missingRealCredentials(env).length > 0) return null;
  return {
    bedrock: {
      region: env['BEDROCK_REGION'] ?? '',
      accessKeyId: env['BEDROCK_ACCESS_KEY_ID'] ?? '',
      secretAccessKey: env['BEDROCK_SECRET_ACCESS_KEY'] ?? '',
      modelId: env['BEDROCK_MODEL_ID'] ?? '',
    },
    sarvamApiKey: env['SARVAM_API_KEY'] ?? '',
  };
}

/** `auto` picks real when the credentials are complete; `real` without them is an error. */
export function resolveMode(requested: 'auto' | BenchMode, env: Env): BenchMode {
  if (requested === 'mock') return 'mock';
  const missing = missingRealCredentials(env);
  if (requested === 'real') {
    if (missing.length > 0) throw new Error(`real providers need: ${missing.join(', ')}`);
    return 'real';
  }
  return missing.length === 0 ? 'real' : 'mock';
}

/** In-memory gateway ports: no database, no budget limit, nothing persisted. */
function benchPorts(): GatewayPorts {
  let n = 0;
  return {
    settings: {
      getPolicy: () =>
        Promise.resolve({ indiaOnly: true, matterSensitive: false, captureAiBlocked: false }),
    },
    budget: {
      reserve: () => Promise.resolve({ id: 'bench' }),
      commit: () => Promise.resolve(),
      release: () => Promise.resolve(),
    },
    audit: {
      record: () => {
        n += 1;
        return Promise.resolve({ id: `bench-${String(n)}` });
      },
    },
  };
}

export function createBenchGateway(mode: BenchMode, creds: RealCredentials | null): AiGateway {
  const providers: Provider[] =
    mode === 'mock' || creds === null
      ? [createMockProvider()]
      : [
          createBedrockProvider(creds.bedrock),
          createSarvamProvider({ apiKey: creds.sarvamApiKey, noTrainingConfirmed: true }),
        ];
  return createGateway({ providers, ports: benchPorts() });
}

export interface Recording {
  fixture: BenchFixture;
  audio: Uint8Array;
  mimeType: string;
  durationSeconds: number;
}

/** One generated 60 s recording per fixture, or caller-supplied recordings (see the runbook). */
export function defaultRecordings(seconds = NOTE_SECONDS): Recording[] {
  return BENCH_FIXTURES.map((fixture, i) => ({
    fixture,
    audio: syntheticWav(seconds, 220 + i * 40),
    mimeType: 'audio/wav',
    durationSeconds: seconds,
  }));
}

export interface IterationResult {
  iteration: number;
  fixture: string;
  ok: boolean;
  error?: string;
  totalMs: number;
  stagesMs: Record<Stage, number>;
}

export interface BenchReport {
  mode: BenchMode;
  startedAt: string;
  iterations: number;
  warmup: number;
  noteSeconds: number;
  budgetP95Ms: number;
  /** Whether the budget is enforced: real runs only. */
  budgetEnforced: boolean;
  failures: number;
  endToEnd: LatencySummary;
  stages: Record<Stage, LatencySummary>;
  budgetMet: boolean | null;
  runs: IterationResult[];
}

export interface RunOptions {
  gateway: AiGateway;
  mode: BenchMode;
  iterations: number;
  warmup?: number;
  recordings?: readonly Recording[];
  now?: () => number;
  budgetP95Ms?: number;
}

async function runOnce(
  gateway: AiGateway,
  recording: Recording,
  iteration: number,
  now: () => number,
): Promise<IterationResult> {
  const captureId = `bench-${String(iteration)}`;
  const scope = { workspaceId: WORKSPACE, captureId };
  const stagesMs: Record<Stage, number> = { transcribe: 0, structure: 0, match_and_draft: 0 };
  const t0 = now();
  try {
    const transcript = await createGatewayTranscribe({
      gateway,
      scope,
      pipelineVersion: PIPELINE_VERSION,
    }).transcribe({
      audio: recording.audio,
      mimeType: recording.mimeType,
      durationSeconds: recording.durationSeconds,
      languageHints: recording.fixture.languageHints,
    });
    const t1 = now();
    stagesMs.transcribe = t1 - t0;
    // Real speech-to-text may return nothing for a tone; the structuring step then gets the
    // fixture text, so the second call is still timed on a realistic input.
    const text = transcript.text.trim() === '' ? recording.fixture.text : transcript.text;
    const structured = await structureHearing({
      gateway,
      scope,
      pipelineVersion: PIPELINE_VERSION,
    })({
      transcript: text,
      hearingDate: recording.fixture.hearingDate,
      languageHints: recording.fixture.languageHints,
    });
    const t2 = now();
    stagesMs.structure = t2 - t1;
    const match = rankMatters(text, [
      { matterId: 'bench-matter-1', caseNumbers: ['W.P. 12345 of 2026'], parties: ['Sharma'] },
    ]);
    hearingToProposalDrafts({
      captureId,
      hearingDate: recording.fixture.hearingDate,
      structured: structured.structured,
      match,
      confidence: structured.confidence,
      anchorFor: (span) => `${String(span.start)}-${String(span.end)}`,
    });
    const t3 = now();
    stagesMs.match_and_draft = t3 - t2;
    return { iteration, fixture: recording.fixture.id, ok: true, totalMs: t3 - t0, stagesMs };
  } catch (error) {
    return {
      iteration,
      fixture: recording.fixture.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      totalMs: now() - t0,
      stagesMs,
    };
  }
}

export async function runBenchmark(options: RunOptions): Promise<BenchReport> {
  const { gateway, mode, iterations } = options;
  const warmup = options.warmup ?? 1;
  const recordings = options.recordings ?? defaultRecordings();
  const now = options.now ?? ((): number => performance.now());
  const budget = options.budgetP95Ms ?? BUDGET_P95_MS;
  if (recordings.length === 0) throw new Error('no recordings to run');
  const startedAt = new Date().toISOString();
  for (let i = 0; i < warmup; i += 1) {
    await runOnce(gateway, recordings[i % recordings.length] as Recording, -1 - i, now);
  }
  const runs: IterationResult[] = [];
  for (let i = 0; i < iterations; i += 1) {
    runs.push(await runOnce(gateway, recordings[i % recordings.length] as Recording, i, now));
  }
  const good = runs.filter((r) => r.ok);
  const stages = Object.fromEntries(
    STAGES.map((s) => [s, summarise(good.map((r) => r.stagesMs[s]))]),
  ) as Record<Stage, LatencySummary>;
  const endToEnd = summarise(good.map((r) => r.totalMs));
  const enforced = mode === 'real';
  return {
    mode,
    startedAt,
    iterations,
    warmup,
    noteSeconds: recordings[0]?.durationSeconds ?? NOTE_SECONDS,
    budgetP95Ms: budget,
    budgetEnforced: enforced,
    failures: runs.length - good.length,
    endToEnd,
    stages,
    budgetMet: enforced ? good.length > 0 && endToEnd.p95Ms < budget : null,
    runs,
  };
}

/**
 * Problems that fail a run. On mocks only the harness is checked (every iteration ran, the report
 * has finite percentiles, and nothing took longer than `sanityMs`); on real providers the budget
 * and any failed iteration also fail it.
 */
export function reportProblems(report: BenchReport, sanityMs = 10_000): string[] {
  const problems: string[] = [];
  if (report.runs.length !== report.iterations) problems.push('missing iterations');
  if (report.failures > 0) {
    const first = report.runs.find((r) => !r.ok);
    problems.push(`${String(report.failures)} iteration(s) failed: ${first?.error ?? 'unknown'}`);
  }
  const { p50Ms, p95Ms, p99Ms } = report.endToEnd;
  if (![p50Ms, p95Ms, p99Ms].every(Number.isFinite)) problems.push('percentiles are not finite');
  if (report.mode === 'mock' && report.endToEnd.maxMs > sanityMs) {
    problems.push(`mock run slower than the ${String(sanityMs)} ms sanity bound`);
  }
  if (report.budgetEnforced && report.budgetMet === false) {
    problems.push(
      `p95 ${report.endToEnd.p95Ms.toFixed(0)} ms is not under the ${String(report.budgetP95Ms)} ms budget`,
    );
  }
  return problems;
}

const ms = (v: number): string => (Number.isFinite(v) ? v.toFixed(1) : 'n/a');

export function renderMarkdown(report: BenchReport): string {
  const row = (name: string, s: LatencySummary): string =>
    `| ${name} | ${String(s.count)} | ${ms(s.p50Ms)} | ${ms(s.p95Ms)} | ${ms(s.p99Ms)} | ${ms(s.maxMs)} |`;
  const verdict =
    report.budgetMet === null
      ? 'not enforced (mock providers measure the harness, not the providers)'
      : report.budgetMet
        ? 'met'
        : 'NOT met';
  return [
    `# Pipeline p95 benchmark (${report.mode} providers)`,
    '',
    `- Started: ${report.startedAt}`,
    `- Iterations: ${String(report.iterations)} (warm-up ${String(report.warmup)}, failures ${String(report.failures)})`,
    `- Note length: ${String(report.noteSeconds)} s`,
    `- Budget: p95 end-to-end under ${String(report.budgetP95Ms)} ms; ${verdict}`,
    '',
    '| Stage | n | p50 ms | p95 ms | p99 ms | max ms |',
    '| --- | --- | --- | --- | --- | --- |',
    row('end to end', report.endToEnd),
    ...STAGES.map((s) => row(s, report.stages[s])),
    '',
  ].join('\n');
}
