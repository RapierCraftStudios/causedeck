// Writes `docs/engineering/permissions.md` from the permission matrix. `--check` fails when the
// committed file differs, for CI (#231).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { renderPermissionsDoc } from '../src/policy/docs.ts';

const target = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'docs',
  'engineering',
  'permissions.md',
);
const expected = renderPermissionsDoc();

if (process.argv.includes('--check')) {
  const actual = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (actual !== expected) {
    console.error(
      'docs/engineering/permissions.md is out of date. Run `pnpm docs:permissions` and commit the result.',
    );
    process.exit(1);
  }
  console.log('docs/engineering/permissions.md is up to date.');
} else {
  writeFileSync(target, expected);
  console.log(`Wrote ${path.relative(process.cwd(), target)}`);
}
