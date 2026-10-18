// Flat config for React libraries (packages/ui) and React apps.
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const react = [
  ...base,
  {
    files: ['**/*.{jsx,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  reactHooks.configs.flat['recommended-latest'],
];

export default react;
