import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@causedeck/drafting',
    coverage: {
      include: ['src/slots.ts', 'src/presets/**'],
      thresholds: { lines: 90 },
    },
  },
});
