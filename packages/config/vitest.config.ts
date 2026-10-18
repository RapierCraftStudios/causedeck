import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@causedeck/config',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Cold type-aware ESLint runs reach 90 s on a contended 2-vCPU CI runner.
    testTimeout: 120_000,
  },
});
