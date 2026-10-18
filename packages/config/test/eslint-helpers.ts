import path from 'node:path';
import { Worker } from 'node:worker_threads';

import type { ESLint } from 'eslint';

export const fixturesDir = path.join(import.meta.dirname, '..', 'eslint', '__fixtures__');

type LintReply = { id: number; result?: ESLint.LintResult; error?: string };
type Pending = { resolve: (result: ESLint.LintResult) => void; reject: (error: Error) => void };

// A cold type-aware lint blocks its thread for up to 90 s on CI. Run in the vitest worker, that
// starves vitest's fixed 60 s worker RPC ("Timeout calling onTaskUpdate") even though tests pass.
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, Pending>();

function lintWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('lint-fixture-worker.js', import.meta.url));
  created.unref();
  created.on('message', ({ id, result, error }: LintReply) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (result) request.resolve(result);
    else request.reject(new Error(error ?? 'ESLint returned no result'));
  });
  created.on('error', (error) => {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker = undefined;
  });
  worker = created;
  return created;
}

/** Lint one fixture file with the shared base config, using its fixture root as cwd. */
export function lintFixture(root: string, file: string): Promise<ESLint.LintResult> {
  const cwd = path.join(fixturesDir, root);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    lintWorker().postMessage({ id, cwd, file });
  });
}

export function ruleIds(result: ESLint.LintResult): (string | null)[] {
  return result.messages.map((message) => message.ruleId);
}
