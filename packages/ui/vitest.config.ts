import path from 'node:path';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import tailwindcss from '@tailwindcss/vite';
import type { BrowserCommand } from 'vitest/node';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

const dirname = import.meta.dirname;
const alias = { '@': path.join(dirname, 'src') };

/** Emulate `prefers-reduced-motion` in the browser page (Playwright `page.emulateMedia`). */
const emulateReducedMotion: BrowserCommand<['reduce' | 'no-preference']> = async (
  { page },
  reducedMotion,
) => {
  await page.emulateMedia({ reducedMotion });
};

/** Headless Chromium; the instance carries the project name so `--project <name>` selects it. */
const chromium = (name: string) => ({
  enabled: true,
  headless: true,
  provider: 'playwright',
  instances: [{ browser: 'chromium' as const, name: `${name} (chromium)` }],
  commands: { emulateReducedMotion },
});

/** Every story as a test: play-function interactions plus axe (addon-a11y `test: 'error'`). */
const storybookProject = (
  name: string,
  theme: 'light' | 'dark',
): TestProjectInlineConfiguration => ({
  resolve: { alias },
  plugins: [
    storybookTest({ configDir: path.join(dirname, '.storybook') }),
    // storybookTest keys its Vite cacheDir on configDir, which both themes share. Their dep
    // optimisers then race on one cache and stale prebundles fail every story with "Failed to
    // fetch dynamically imported module". Give each project its own cache (runs after the plugin).
    {
      name: 'causedeck:project-cache-dir',
      enforce: 'post',
      config: () => ({ cacheDir: path.join(dirname, 'node_modules/.cache/sb-vitest', name) }),
    },
  ],
  test: {
    name,
    browser: chromium(name),
    setupFiles: ['.storybook/vitest.setup.ts'],
    provide: { theme },
  },
});

/** Node and jsdom tests: what `pnpm test` (turbo, CI) runs. No browser needed. */
const unitTest = {
  include: [
    'src/**/*.test.{ts,tsx}',
    'tokens/**/*.test.ts',
    'scripts/**/*.test.ts',
    'test/**/*.test.ts',
    'visual/**/*.test.ts',
  ],
  exclude: ['**/*.browser.test.{ts,tsx}', '**/node_modules/**'],
  environment: 'node',
  setupFiles: ['test/setup.ts'],
  // The first type-aware ESLint run (test/eslint-rules.test.ts) cold-starts in 30-65 s on a
  // contended 2-vCPU CI runner; @causedeck/config allows the same.
  testTimeout: 120_000,
};

export default defineConfig({
  resolve: { alias },
  // The root vitest.workspace.ts loads this file as one project and ignores `projects`, so the
  // top level runs the unit tests too. The projects below do not extend it.
  test: {
    ...unitTest,
    projects: [
      { resolve: { alias }, test: { ...unitTest, name: 'unit' } },
      {
        // Real-browser checks that need layout or media emulation (reduced motion, no shift).
        resolve: { alias },
        plugins: [tailwindcss()],
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: chromium('browser'),
          setupFiles: ['test/setup.ts'],
        },
      },
      storybookProject('storybook', 'light'),
      storybookProject('storybook-dark', 'dark'),
    ],
  },
});

declare module 'vitest' {
  export interface ProvidedContext {
    theme: 'light' | 'dark';
  }
}
