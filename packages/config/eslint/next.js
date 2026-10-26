// Flat config for Next.js apps (web, site, admin): the React rules plus Next.js app conventions.
import globals from 'globals';

import { serverActionAuthorization } from './authorization.js';
import { loggerContentRestrictions } from './base.js';
import { react } from './react.js';

/** Routes run on the Node runtime so data stays in India (spike §1, §3.1); edge is never used. */
export const edgeRuntimeRestriction = {
  selector:
    "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.name='runtime'][init.value='edge']",
  message: "Use the Node runtime (spike §3.1): `export const runtime = 'edge'` is not allowed.",
};

/** @type {import('eslint').Linter.Config[]} */
export const next = [
  ...react,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-restricted-syntax': ['error', ...loggerContentRestrictions, edgeRuntimeRestriction],
    },
  },
  // Server actions must authorize (#235).
  serverActionAuthorization,
];

export default next;
