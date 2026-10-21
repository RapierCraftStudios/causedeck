// Storybook for apps/web (#426): the app's own components (courts first) with the real next-intl
// catalogs and mocked Next navigation. Mirrors packages/ui/.storybook/main.ts; ui keeps its own.
import type { StorybookConfig } from '@storybook/nextjs-vite';
import tailwindcss from '@tailwindcss/vite';

const config: StorybookConfig = {
  framework: { name: '@storybook/nextjs-vite', options: {} },
  stories: ['../components/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  // next/font (app/fonts.ts) does not run here: serve the ui faces that storybook.css loads.
  staticDirs: [{ from: '../../../packages/ui/fonts', to: '/fonts' }],
  core: { disableTelemetry: true },
  viteFinal: (viteConfig) => {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss()];
    return viteConfig;
  },
};

export default config;
