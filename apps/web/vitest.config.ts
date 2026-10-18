import { defineConfig } from 'vitest/config';

// Node by default; component tests opt into jsdom with `// @vitest-environment jsdom`.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: [
      '__tests__/**/*.test.{ts,tsx}',
      'app/**/__tests__/**/*.test.ts',
      'components/**/__tests__/**/*.test.{ts,tsx}',
      'src/**/*.test.ts',
    ],
    environment: 'node',
    // Full app-shell renders under jsdom take 3-5 s on a contended 2-vCPU CI runner (turbo runs
    // every workspace's tests at once); the 5 s default left no headroom.
    testTimeout: 20_000,
  },
});
