import { defineProject } from 'vitest/config';

export default defineProject({
  // Pipeline tests parse PDFs, render pages and load fonts; the first ones in a file pay the cold
  // load of those libraries, which takes over the default 5 s on a shared CI runner.
  test: { name: '@causedeck/intelligence', testTimeout: 30_000 },
});
