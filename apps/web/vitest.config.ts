import { defineConfig } from 'vitest/config';

// Naming a cross-tenant suite on the command line (`vitest run __tests__/cross-tenant-x.test.ts`)
// runs it with the same database setup as `vitest.tenancy.config.ts`; a bare `vitest run` still skips them.
const tenancy = process.argv.some((arg) => /__tests__\/cross-tenant-[^/]*\.test\.ts$/.test(arg));

// Node by default; component tests opt into jsdom with `// @vitest-environment jsdom`.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: [
      '__tests__/**/*.test.{ts,tsx}',
      'app/**/__tests__/**/*.test.ts',
      'app/**/_components/**/*.test.{ts,tsx}',
      'components/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/*.test.ts',
    ],
    // Cross-tenant suites need the test database; `vitest.tenancy.config.ts` runs them (#209).
    exclude: tenancy
      ? ['**/node_modules/**']
      : ['**/node_modules/**', '__tests__/cross-tenant-*.test.ts'],
    globalSetup: tenancy ? ['@causedeck/db/testing/global-setup'] : [],
    hookTimeout: tenancy ? 120_000 : 10_000,
    environment: 'node',
    // Full app-shell renders under jsdom take 3-5 s on a contended 2-vCPU CI runner (turbo runs
    // every workspace's tests at once); the 5 s default left no headroom. A change that touches
    // db or core runs every package's tests at once, and 20 s was then exceeded by a test that
    // takes 2 s on a free host (the first jsdom or server-action import is the slow part).
    testTimeout: 60_000,
  },
});
