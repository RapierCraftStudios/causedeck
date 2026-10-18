import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@causedeck/auth',
    // One Testcontainers Postgres per run, migrated, shared by every worker (#6 harness).
    globalSetup: ['@causedeck/db/testing/global-setup'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
