import { node } from './eslint/node.js';

export default [
  ...node,
  { ignores: ['eslint/__fixtures__/**'] },
  // Linted from this package, paths are relative to it: the env module and its generator are the
  // only code allowed to read `process.env`.
  { files: ['src/env/**', 'scripts/**'], rules: { 'no-process-env': 'off' } },
];
