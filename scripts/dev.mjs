// Root `pnpm dev`: start every workspace that defines a `dev` script through Turborepo. Until
// some workspace has one, print a clear message and exit cleanly instead of failing.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const workspaceDirs = [
  ...['apps', 'packages'].flatMap((group) => {
    const dir = path.join(root, group);
    return existsSync(dir) ? readdirSync(dir).map((name) => path.join(dir, name)) : [];
  }),
  path.join(root, 'e2e'),
];

const withDev = workspaceDirs.filter((dir) => {
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  const { scripts } = JSON.parse(readFileSync(manifest, 'utf8'));
  return typeof scripts?.dev === 'string';
});

if (withDev.length === 0) {
  console.log('pnpm dev: no workspace defines a "dev" script yet, so there is nothing to start.');
  console.log('Add a "dev" script to an app (for example apps/web) and run `pnpm dev` again.');
  process.exit(0);
}

console.log(`pnpm dev: starting ${withDev.map((dir) => path.relative(root, dir)).join(', ')}`);
const result = spawnSync('pnpm', ['exec', 'turbo', 'run', 'dev', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
