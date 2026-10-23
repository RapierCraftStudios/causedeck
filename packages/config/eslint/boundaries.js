// Dependency boundaries from the technical spike §2, enforced with eslint-plugin-boundaries.
//
// - Apps may import packages. Packages never import apps.
// - Apps never value-import `@causedeck/db` (#299): they reach the database through `@causedeck/core`
//   (e.g. `@causedeck/core/runtime`). `import type` is fine, and test files may take values from
//   `@causedeck/db/testing` (plus `testing/*` and `seed/*`). See `appDbImportBlocks` below.
// - `ui` is domain-free: it may import only `config` and `validators` (plus external primitives).
// - `core` is the domain layer and may import the packages listed in CORE_DEPENDENCIES.
// - `observability` may import only `config`, so logging never depends on domain code.
// - `db` is a leaf under the domain packages: it may import only DB_DEPENDENCIES (#297).
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
  'capture',
  'ai',
  'adapters',
  'intelligence',
  'fetch',
  'drafting',
  'notifications',
  'billing',
  'validators',
  'observability',
  'config',
];

/** Packages that `observability` may depend on: no domain packages (#13). */
export const OBSERVABILITY_DEPENDENCIES = ['config'];

/**
 * Packages that `db` may depend on (#297): no domain packages. `validators` is the zod-only leaf
 * that holds the GSTIN pattern and the plan catalogue the billing tables and seed need.
 */
export const DB_DEPENDENCIES = ['config', 'i18n', 'validators'];

/** Packages that `ui` may depend on. */
export const UI_DEPENDENCIES = ['config', 'validators'];

const pkg = (name) => ['package', { pkg: name }];

/**
 * `withoutWorkspace` (#19) drops the tenancy scope for allow-listed global tables. Only the db
 * package, the admin console's audited data layer (`apps/admin/lib/data`, #309) and migrations may
 * import it; everything else works inside
 * `withWorkspace` / `withUser`. A separate rule from core `no-restricted-imports`, whose per-glob
 * blocks replace one another. Defined here so the app→db blocks can carry it (a flat-config block
 * replaces the rule's options); `base.js` re-exports it.
 */
const WITHOUT_WORKSPACE_MESSAGE =
  '`withoutWorkspace` is for packages/db, the apps/admin data layer (apps/admin/lib/data) and migrations only (docs/engineering/tenancy.md). Use `withWorkspace` or `withUser`.';
export const withoutWorkspaceImportBan = {
  paths: ['@causedeck/db', '@causedeck/db/rls'].map((name) => ({
    name,
    importNames: ['withoutWorkspace'],
    message: WITHOUT_WORKSPACE_MESSAGE,
  })),
};

/** Test files inside an app, relative to the app folder glob. */
const APP_TEST_FILES = ['**/__tests__/**', '**/*.{test,spec}.{ts,tsx,mts,cts,js,mjs}'];

const APP_DB_MESSAGE =
  'Apps reach the database through `@causedeck/core` (e.g. `@causedeck/core/runtime`), not `@causedeck/db`; only `import type` is allowed (spike §2, #299).';
const APP_DB_TEST_MESSAGE =
  'App tests take db values from `@causedeck/db/testing` (or `testing/*`, `seed/*`); other `@causedeck/db` entries are `import type` only (spike §2, #299).';

/**
 * `@typescript-eslint/no-restricted-imports` options for app files: no value import of
 * `@causedeck/db` (any entry), `import type` allowed. Test files may value-import the
 * `testing` and `seed` entries. With `withoutWorkspace: false` (an exempt folder) the root entry's
 * `withoutWorkspace` is allowed as a value too.
 *
 * @param {{ test: boolean; withoutWorkspace: boolean }} options
 */
export function appDbImportBan({ test, withoutWorkspace }) {
  const message = test ? APP_DB_TEST_MESSAGE : APP_DB_MESSAGE;
  const allowedInTests = [
    '!@causedeck/db/testing',
    '!@causedeck/db/testing/*',
    '!@causedeck/db/seed',
    '!@causedeck/db/seed/*',
  ];
  return {
    paths: [
      ...(withoutWorkspace ? withoutWorkspaceImportBan.paths : []),
      {
        name: '@causedeck/db',
        allowTypeImports: true,
        // An exempt folder (the admin data layer, #309) may take `withoutWorkspace` as a value.
        ...(withoutWorkspace ? {} : { allowImportNames: ['withoutWorkspace'] }),
        message,
      },
    ],
    patterns: [
      {
        group: ['@causedeck/db/*', ...(test ? allowedInTests : [])],
        allowTypeImports: true,
        message,
      },
    ],
  };
}

/**
 * The app→db blocks for the app folders matched by `appGlob`: one for source files, one for test
 * files.
 *
 * @param {string} appGlob
 * @param {{ withoutWorkspace: boolean }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function appDbImportBlocks(appGlob, { withoutWorkspace }) {
  const testFiles = APP_TEST_FILES.map((glob) => `${appGlob}/${glob}`);
  return [
    {
      files: [`${appGlob}/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}`],
      ignores: testFiles,
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          appDbImportBan({ test: false, withoutWorkspace }),
        ],
      },
    },
    {
      files: testFiles,
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          appDbImportBan({ test: true, withoutWorkspace }),
        ],
      },
    },
  ];
}

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
            // Which `@causedeck/db` entries an app may import is `appDbImportBlocks` (#299).
            { from: ['app'], allow: ['package'] },
            { from: ['package'], allow: ['package'] },
            { from: ['package'], disallow: [pkg('core'), pkg('ui')] },
            { from: [pkg('ui')], disallow: ['package'] },
            { from: [pkg('ui')], allow: UI_DEPENDENCIES.map(pkg) },
            { from: [pkg('core')], disallow: ['package'] },
            { from: [pkg('core')], allow: CORE_DEPENDENCIES.map(pkg) },
            { from: [pkg('observability')], disallow: ['package'] },
            { from: [pkg('observability')], allow: OBSERVABILITY_DEPENDENCIES.map(pkg) },
            { from: [pkg('db')], disallow: ['package'] },
            { from: [pkg('db')], allow: DB_DEPENDENCIES.map(pkg) },
          ],
        },
      ],
    },
  },
  ...appDbImportBlocks('**/apps/*', { withoutWorkspace: true }),
];

export default boundaries;
