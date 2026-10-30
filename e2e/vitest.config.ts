import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Unit tests of the perf helpers (#105). The root is the repository root so the test path reads
// `e2e/perf/...` in every checkout; Playwright specs (`tests/*.spec.ts`) are never collected.
export default defineConfig({
  test: {
    root: fileURLToPath(new URL('..', import.meta.url)),
    include: ['e2e/perf/__tests__/**/*.test.ts'],
  },
});
