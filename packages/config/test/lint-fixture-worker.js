// Lints fixtures off the vitest worker's thread (see eslint-helpers.ts). One worker serves every
// lint in a test file, so typescript-eslint's program stays warm after the first, cold run.
import path from 'node:path';
import { parentPort } from 'node:worker_threads';

import { ESLint } from 'eslint';

import { base } from '../eslint/base.js';

if (!parentPort) throw new Error('lint-fixture-worker.js must run as a worker thread');
const port = parentPort;

port.on('message', (/** @type {{ id: number; cwd: string; file: string }} */ request) => {
  const { id, cwd, file } = request;
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [...base, { languageOptions: { parserOptions: { tsconfigRootDir: cwd } } }],
  });
  eslint.lintFiles([path.join(cwd, file)]).then(
    ([result]) => {
      port.postMessage({ id, result });
    },
    (/** @type {unknown} */ error) => {
      port.postMessage({
        id,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
    },
  );
});
