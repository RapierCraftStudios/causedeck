// Every apps/web story as a browser test (#426): play-function interactions plus axe (addon-a11y
// `test: 'error'`) in light and in dark. Kept apart from vitest.config.ts so `pnpm test` and the
// root vitest.workspace.ts stay node/jsdom only; CI runs this in the Storybook workflow.
import path from 'node:path';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { defineConfig, type TestProjectInlineConfiguration } from 'vitest/config';

const dirname = import.meta.dirname;

/** Headless Chromium; the instance carries the project name so `--project <name>` selects it. */
const chromium = (name: string) => ({
  enabled: true,
  headless: true,
  provider: 'playwright',
  instances: [{ browser: 'chromium' as const, name: `${name} (chromium)` }],
});

const storybookProject = (
  name: string,
  theme: 'light' | 'dark',
): TestProjectInlineConfiguration => ({
  plugins: [
    storybookTest({ configDir: path.join(dirname, '.storybook') }),
    // Both themes share one configDir and so one Vite cacheDir; their dep optimisers would race on
    // it (see packages/ui/vitest.config.ts). Give each project its own cache.
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

export default defineConfig({
  test: {
    projects: [storybookProject('storybook', 'light'), storybookProject('storybook-dark', 'dark')],
  },
});

declare module 'vitest' {
  export interface ProvidedContext {
    theme: 'light' | 'dark';
  }
}
