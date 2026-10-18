import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@causedeck/config',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
