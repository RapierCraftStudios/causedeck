// The deterministic mock provider (dev and CI; no network). A response is keyed by
// `(task, sha256(normalised input))`: a fixture file `fixtures/mock/<task>/<hash>.json` with
// `{ "output": ..., "usage"?: ... }` wins, otherwise a schema-valid synthetic value is returned.
// `withRecording` wraps a real provider to capture responses into fixtures, only for inputs the
// caller marks synthetic, so customer content never reaches the repository.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { inputHash } from '../hash.ts';
import {
  TASK_IDS,
  type CallOptions,
  type Provider,
  type ProviderResult,
  type TaskDef,
} from '../types.ts';
import { synthesise } from './synthetic.ts';

export const DEFAULT_FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/mock',
);

export interface MockOptions {
  fixturesDir?: string;
}

interface Fixture {
  output: unknown;
  usage?: ProviderResult['usage'];
}

export function fixturePath(dir: string, task: string, input: unknown): string {
  return path.join(dir, task, `${inputHash(input)}.json`);
}

export function createMockProvider({
  fixturesDir = DEFAULT_FIXTURES_DIR,
}: MockOptions = {}): Provider {
  return {
    id: 'mock',
    region: 'local',
    // Nothing leaves the process, so the mock is allowed under India-only mode.
    dataResidency: 'in',
    supports: TASK_IDS,
    modelFor: () => 'mock',
    call(task: TaskDef, input: unknown, opts: CallOptions): Promise<ProviderResult> {
      const file = fixturePath(fixturesDir, task.id, input);
      let output: unknown;
      let usage: ProviderResult['usage'] = { inputTokens: 0, outputTokens: 0 };
      // A repair attempt skips the fixture: it already failed validation.
      if (opts.repair === undefined && existsSync(file)) {
        const fixture = JSON.parse(readFileSync(file, 'utf8')) as Fixture;
        output = fixture.output;
        usage = fixture.usage ?? usage;
      } else {
        output = synthesise(task.output);
      }
      return Promise.resolve({ output, usage, model: 'mock', modelVersion: 'mock-1' });
    },
  };
}

export interface RecordingOptions {
  fixturesDir?: string;
  /** Only inputs this returns true for are written; everything else passes through untouched. */
  isSynthetic: (task: TaskDef, input: unknown) => boolean;
}

/** Wrap `inner` so its responses to synthetic inputs are saved as mock fixtures. */
export function withRecording(inner: Provider, opts: RecordingOptions): Provider {
  const dir = opts.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  return {
    id: inner.id,
    region: inner.region,
    dataResidency: inner.dataResidency,
    supports: inner.supports,
    modelFor: (task) => inner.modelFor(task),
    async call(task, input, callOpts) {
      const result = await inner.call(task, input, callOpts);
      if (callOpts.repair === undefined && opts.isSynthetic(task, input)) {
        const file = fixturePath(dir, task.id, input);
        mkdirSync(path.dirname(file), { recursive: true });
        const fixture: Fixture = { output: result.output, usage: result.usage };
        writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
      }
      return result;
    },
  };
}
