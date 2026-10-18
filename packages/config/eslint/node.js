// Flat config for Node.js workspaces (api, worker, server-side packages).
import globals from 'globals';

import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const node = [
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
  },
];

export default node;
