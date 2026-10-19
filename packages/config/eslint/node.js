// Flat config for Node.js workspaces (api, worker, server-side packages).
import globals from 'globals';

import { routeAuthorization } from './authorization.js';
import { base } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const node = [
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  // `/v1` routes must authorize (#235); scoped to apps/api by its files globs.
  routeAuthorization,
];

export default node;
