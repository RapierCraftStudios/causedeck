import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@causedeck/db',
    globalSetup: ['./vitest.global-setup.ts'],
    // Pulling the image and starting Postgres can take a while on a cold machine.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
