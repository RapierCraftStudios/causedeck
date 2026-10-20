import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@causedeck/admin',
    // The staff CLI tests run against the shared test Postgres (testcontainers).
    globalSetup: ['@causedeck/db/testing/global-setup'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
