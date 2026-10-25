import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@causedeck/adapters',
    // The access-mode enforcement test reads `access_mode_registry` (#369).
    globalSetup: ['@causedeck/db/testing/global-setup'],
    // Pulling the image and starting Postgres can take a while on a cold machine.
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
