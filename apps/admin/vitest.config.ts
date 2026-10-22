import { defineProject } from 'vitest/config';

// Node by default; component tests opt into jsdom with `// @vitest-environment jsdom`.
export default defineProject({
  esbuild: { jsx: 'automatic' },
  test: {
    name: '@causedeck/admin',
    include: ['__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.ts'],
    environment: 'node',
    // The staff CLI and data-layer tests run against the shared test Postgres (testcontainers).
    globalSetup: ['@causedeck/db/testing/global-setup'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
