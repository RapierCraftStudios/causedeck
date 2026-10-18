// Dependency boundaries from the technical spike §2, enforced with eslint-plugin-boundaries.
//
// - Apps may import packages. Packages never import apps.
// - `ui` is domain-free: it may import only `config` and `validators` (plus external primitives).
// - `core` is the domain layer and may import the packages listed in CORE_DEPENDENCIES.
// - Other packages may import any package except `core` and `ui`. This is kept permissive on
//   purpose so later issues are not blocked; tighten per package when its design settles.
import { createRequire } from 'node:module';

import boundariesPlugin from 'eslint-plugin-boundaries';

const require = createRequire(import.meta.url);

/** Packages that `core` may depend on (spike §2), plus shared config. */
export const CORE_DEPENDENCIES = [
  'db',
  'auth',
  'flags',
  'storage',
  'ai',
  'adapters',
  'intelligence',
  'drafting',
  'notifications',
  'billing',
  'validators',
  'config',
];

/** Packages that `ui` may depend on. */
export const UI_DEPENDENCIES = ['config', 'validators'];

const pkg = (name) => ['package', { pkg: name }];

/** App workspace names. Packages cannot depend on them, so the import would not even resolve. */
export const APP_NAMES = ['web', 'site', 'api', 'worker', 'admin'];

/** @type {import('eslint').Linter.Config[]} */
export const boundaries = [
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    plugins: { boundaries: boundariesPlugin },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*', mode: 'folder', capture: ['app'] },
        { type: 'package', pattern: 'packages/*', mode: 'folder', capture: ['pkg'] },
      ],
      'import/resolver': {
        [require.resolve('eslint-import-resolver-typescript')]: { alwaysTryTypes: true },
        [require.resolve('eslint-import-resolver-node')]: {
          extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
        },
      },
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          // Later rules override earlier ones; within one rule `disallow` wins over `allow`.
          rules: [
            { from: ['app'], allow: ['package'] },
            { from: ['package'], allow: ['package'] },
            { from: ['package'], disallow: [pkg('core'), pkg('ui')] },
            { from: [pkg('ui')], disallow: ['package'] },
            { from: [pkg('ui')], allow: UI_DEPENDENCIES.map(pkg) },
            { from: [pkg('core')], disallow: ['package'] },
            { from: [pkg('core')], allow: CORE_DEPENDENCIES.map(pkg) },
          ],
        },
      ],
    },
  },
];

export default boundaries;
