import { defineProject } from 'vitest/config';

// `test:golden` (#371): the golden-fixture harness and synthetic generators only. No database
// globalSetup, so the run needs no Docker; the default `test` run includes these files too.
export default defineProject({
  test: {
    name: '@causedeck/adapters:golden',
    include: ['src/__tests__/golden.test.ts', 'src/__tests__/synthetic.test.ts'],
    testTimeout: 60_000,
  },
});
