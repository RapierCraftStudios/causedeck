import { defineConfig } from 'vitest/config';

// Node by default; component tests opt into jsdom with `// @vitest-environment jsdom`.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'lib/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.next/**', 'out/**'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
