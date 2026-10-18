import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@causedeck/worker',
    globalSetup: ['@causedeck/db/testing/global-setup'],
    // Pulling the image and starting Postgres can take a while on a cold machine.
    hookTimeout: 120_000,
    testTimeout: 90_000,
  },
});
