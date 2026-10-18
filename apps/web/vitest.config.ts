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
  },
});
