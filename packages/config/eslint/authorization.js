// The local `causedeck` ESLint plugin and the blocks that enable `causedeck/require-authorization`
// (#235): server actions in the Next.js apps and `/v1` routes in apps/api must authorize. The plugin
// also carries `causedeck/core-domain-boundaries` (#293), enabled for packages/core in base.js.
import { coreDomainBoundaries } from './rules/core-domain-boundaries.js';
import { requireAuthorization } from './rules/require-authorization.js';

/** @type {import('eslint').ESLint.Plugin} */
export const causedeck = {
  meta: { name: 'causedeck' },
  rules: {
    'require-authorization': requireAuthorization,
    'core-domain-boundaries': coreDomainBoundaries,
  },
};

/** Every module of a Next.js app; the rule only acts on `'use server'` code. */
export const serverActionAuthorization = {
  files: ['**/*.{ts,tsx}'],
  plugins: { causedeck },
  rules: { 'causedeck/require-authorization': 'error' },
};

/** The `/v1` route files, from apps/api (its own config) or the repo root (pre-commit). */
export const routeAuthorization = {
  files: ['src/routes/v1/*.ts', '**/apps/api/src/routes/v1/*.ts'],
  plugins: { causedeck },
  rules: { 'causedeck/require-authorization': 'error' },
};
