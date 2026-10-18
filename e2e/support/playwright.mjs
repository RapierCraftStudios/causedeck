// Entry point of the `test*` scripts: runs the Playwright CLI with the given arguments, except
// under Turborepo. `turbo run test` (root `pnpm test`, the CI unit-test job) passes Vitest flags
// to every workspace and must never build the app or start browsers; the e2e suite runs from
// `pnpm --filter @causedeck/e2e test` and .github/workflows/e2e.yml instead.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line no-process-env -- Turborepo's task marker.
if (process.env.TURBO_HASH !== undefined) {
  console.log('e2e: skipped under Turborepo; run `pnpm --filter @causedeck/e2e test`.');
  process.exit(0);
}

const cli = fileURLToPath(import.meta.resolve('@playwright/test/cli'));
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
