// Writes the repo-root `.env.example` from the env schema. `--check` fails when the committed file
// differs, for CI (#3).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { renderEnvExample } from '../src/env/example.ts';

const target = path.resolve(import.meta.dirname, '..', '..', '..', '.env.example');
const expected = renderEnvExample();

if (process.argv.includes('--check')) {
  const actual = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (actual !== expected) {
    console.error('.env.example is out of date. Run `pnpm env:example` and commit the result.');
    process.exit(1);
  }
  console.log('.env.example is up to date.');
} else {
  writeFileSync(target, expected);
  console.log(`Wrote ${path.relative(process.cwd(), target)}`);
}
