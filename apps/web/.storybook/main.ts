// Storybook for apps/web (#426): the app's own components (courts first) with the real next-intl
// catalogs and mocked Next navigation. Mirrors packages/ui/.storybook/main.ts; ui keeps its own.
import path from 'node:path';

import type { StorybookConfig } from '@storybook/nextjs-vite';
import tailwindcss from '@tailwindcss/vite';
import type { Alias, AliasOptions } from 'vite';

const isAliasList = (aliases: AliasOptions): aliases is readonly Alias[] => Array.isArray(aliases);

const config: StorybookConfig = {
  framework: { name: '@storybook/nextjs-vite', options: {} },
  stories: [
    '../components/**/*.stories.@(ts|tsx)',
    '../app/**/_components/**/*.stories.@(ts|tsx)',
    '../app/**/_offline/**/*.stories.@(ts|tsx)',
    '../app/**/settings/privacy/_offline-card.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  // next/font (app/fonts.ts) does not run here: serve the ui faces that storybook.css loads.
  staticDirs: [{ from: '../../../packages/ui/fonts', to: '/fonts' }],
  core: { disableTelemetry: true },
  viteFinal: (viteConfig, { configDir }) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    // The framework's App Router mock predates Next 16.4's LayoutRouterContext shape: wrap its
    // RedirectBoundary so `useRouter()` works (see redirect-boundary.ts). Exact match only; the
    // shim itself imports Next's boundary through the `.js` path.
    // Vite's alias option is an array of { find, replacement } or a find -> replacement record.
    const aliases: AliasOptions = viteConfig.resolve?.alias ?? [];
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: [
        {
          find: /^next\/dist\/client\/components\/redirect-boundary$/,
          replacement: path.resolve(configDir, 'redirect-boundary.ts'),
        },
        ...(isAliasList(aliases)
          ? aliases
          : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }))),
      ],
    };
    return viteConfig;
  },
};

export default config;
