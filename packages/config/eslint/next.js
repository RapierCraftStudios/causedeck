// Flat config for Next.js apps (web, site, admin). Next-specific rules arrive with app code (#10).
import globals from 'globals';

import { react } from './react.js';

/** @type {import('eslint').Linter.Config[]} */
export const next = [
  ...react,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];

export default next;
