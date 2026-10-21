import { defineProject } from 'vitest/config';

// `test:golden` (#371): the golden-fixture harness, synthetic generators and the pure NCLT parser
// tests with their golden metrics (#38). No database globalSetup, so the run needs no Docker; the
// default `test` run includes these files too.
export default defineProject({
  test: {
    name: '@causedeck/adapters:golden',
    include: [
      'src/__tests__/golden.test.ts',
      'src/__tests__/synthetic.test.ts',
      'src/nclt-blr/**/*.test.ts',
    ],
    testTimeout: 60_000,
  },
});
