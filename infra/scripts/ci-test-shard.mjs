// Select the workspaces one `test` shard runs (CI matrix over package groups).
//
//   node infra/scripts/ci-test-shard.mjs <shard> [<turbo filter>]
//
// Prints one `--filter=<package>` argument per line: the packages that `turbo run test` would run
// (for the optional change-aware filter) and that belong to the shard. Prints nothing when none do.
//
// Groups are balanced by measured Vitest duration on the 4-vCPU runner (lane PR run, db/core/auth
// changed): core ~710 s, web ~620 s, admin+api+worker ~600 s, db+auth ~440 s, the rest ~650 s.
// `rest` is every workspace not named by another group, so a new package is covered automatically.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAMED_SHARDS = {
  db: ['@causedeck/db', '@causedeck/auth'],
  core: ['@causedeck/core'],
  web: ['@causedeck/web'],
  services: ['@causedeck/admin', '@causedeck/api', '@causedeck/worker'],
};
export const SHARD_NAMES = [...Object.keys(NAMED_SHARDS), 'rest'];

/** Package names from `turbo run test --dry=json` that have a real `test` script. */
export function testPackages(dryRun) {
  return dryRun.tasks
    .filter((task) => task.task === 'test' && task.command !== '<NONEXISTENT>')
    .map((task) => task.package);
}

/** The subset of `packages` that shard `shard` runs. */
export function selectShard(packages, shard) {
  if (!SHARD_NAMES.includes(shard)) {
    throw new Error(`unknown shard "${shard}" (expected one of ${SHARD_NAMES.join(', ')})`);
  }
  const named = new Set(Object.values(NAMED_SHARDS).flat());
  return packages.filter((name) =>
    shard === 'rest' ? !named.has(name) : NAMED_SHARDS[shard].includes(name),
  );
}

function main() {
  const [shard, filter = ''] = process.argv.slice(2);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const args = ['run', 'test', '--dry=json'];
  if (filter) args.push(`--filter=${filter}`);
  const out = execFileSync(path.join(root, 'node_modules', '.bin', 'turbo'), args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for (const name of selectShard(testPackages(JSON.parse(out)), shard)) {
    console.log(`--filter=${name}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
