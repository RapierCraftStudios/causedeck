import { defineConfig } from 'vitest/config';

// `pnpm test:tenancy` (#209): the cross-tenant server action suite against a real Postgres
// (Testcontainers). The default `vitest.config.ts` excludes these files, so `test` needs no database.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['__tests__/cross-tenant-*.test.ts'],
    environment: 'node',
    globalSetup: ['@causedeck/db/testing/global-setup'],
    // Pulling the image and starting Postgres can take a while on a cold machine.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
