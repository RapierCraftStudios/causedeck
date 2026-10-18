// Project annotations for `@storybook/addon-vitest`. Each Vitest project injects the theme it
// runs in (vitest.config.ts), so every story is axe-checked in light and in dark.
import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview';
import { setProjectAnnotations } from '@storybook/nextjs-vite';
import { inject } from 'vitest';

import * as projectAnnotations from './preview';

setProjectAnnotations([
  a11yAddonAnnotations,
  projectAnnotations,
  { initialGlobals: { theme: inject('theme'), locale: 'en' } },
]);
