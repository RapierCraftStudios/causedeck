// Shared ESLint 9 flat config for every CauseDeck workspace.
import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { causedeck } from './authorization.js';
import {
  APP_NAMES,
  appDbImportBlocks,
  boundaries,
  withoutWorkspaceImportBan,
} from './boundaries.js';

/** Deep imports into another workspace's sources bypass its public `exports`. */
export const deepImportPatterns = [
  {
    group: ['@causedeck/*/src', '@causedeck/*/src/**'],
    message: 'Import from the package entry point (`@causedeck/<pkg>`), not its src/ files.',
  },
  {
    group: ['**/apps/*/src/**', '**/packages/*/src/**'],
    message: 'Import other workspaces by name (`@causedeck/<pkg>`), not by relative path.',
  },
];

/** Packages never import apps (spike §2), including by workspace name. */
export const appImportPattern = {
  group: APP_NAMES.flatMap((app) => [`@causedeck/${app}`, `@causedeck/${app}/**`]),
  message: 'Packages must not import apps (spike §2 dependency rules).',
};

/** Server env holds secrets; client modules use `@causedeck/config/env/client` instead. */
export const serverEnvImportPath = {
  name: '@causedeck/config/env',
  message:
    'Server env must not reach client code. Import `clientEnv` from `@causedeck/config/env/client`.',
};

/**
 * Matter content must never reach logs (PRD §9, #13): ban passing request bodies or content fields
 * to a logger call, whether directly, spread into the log object or as a property value.
 */
const LOG_METHODS = '/^(trace|debug|info|warn|error|fatal)$/';
const LOGGER_NAMES = '/^(logger|log)$/';
const CONTENT_NAMES = '/^(body|content|text|quote|prompt|memoryValue)$/';
const loggerCalls = [
  `CallExpression[callee.property.name=${LOG_METHODS}][callee.object.name=${LOGGER_NAMES}]`,
  `CallExpression[callee.property.name=${LOG_METHODS}][callee.object.property.name=${LOGGER_NAMES}]`,
];
const LOG_CONTENT_MESSAGE =
  'Do not log request bodies or matter content; log ids and lengths instead (docs/engineering/observability.md).';

export const loggerContentRestrictions = loggerCalls.flatMap((call) =>
  [
    `${call} > MemberExpression.arguments[property.name=${CONTENT_NAMES}]`,
    `${call} > Identifier.arguments[name=${CONTENT_NAMES}]`,
    `${call} > ObjectExpression.arguments > SpreadElement > MemberExpression.argument[property.name=${CONTENT_NAMES}]`,
    `${call} > ObjectExpression.arguments > SpreadElement > Identifier.argument[name=${CONTENT_NAMES}]`,
    `${call} > ObjectExpression.arguments > Property > MemberExpression.value[property.name=${CONTENT_NAMES}]`,
  ].map((selector) => ({ selector, message: LOG_CONTENT_MESSAGE })),
);

/** `withoutWorkspace` (#19) import ban; defined in boundaries.js so the app→db blocks reuse it. */
export { withoutWorkspaceImportBan };

/** Where `withoutWorkspace` may be imported. */
export const WITHOUT_WORKSPACE_ALLOWED_GLOBS = [
  '**/packages/db/**',
  '**/apps/admin/**',
  '**/migrations/**',
];

/** Files treated as client modules (browser bundles). */
export const CLIENT_FILE_GLOBS = [
  '**/*.client.{ts,tsx}',
  '**/components/**/*.{ts,tsx}',
  '**/packages/ui/**/*.{ts,tsx}',
];

/** The only places allowed to read `process.env`; everything else goes through the env schema. */
export const PROCESS_ENV_ALLOWED_GLOBS = [
  '**/packages/config/src/env/**',
  '**/packages/config/scripts/**',
  // CI tooling (#3) reads runner variables such as TURBO_FILTER, not app configuration.
  'infra/scripts/**',
];

export const ignores = {
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/playwright-report/**',
    '**/storybook-static/**',
  ],
};

/** @type {import('eslint').Linter.Config[]} */
export const base = tseslint.config(
  ignores,
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.es2023 },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: process.cwd(),
      },
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
    },
    plugins: { unicorn },
    rules: {
      // No `any` in exported (or any) signatures: spike §10.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-declaration-merging': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-unary-minus': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-imports': ['error', { patterns: deepImportPatterns }],
      '@typescript-eslint/no-restricted-imports': ['error', withoutWorkspaceImportBan],
      // Read configuration through `@causedeck/config/env` (spike §3.2), never `process.env`.
      'no-process-env': 'error',
      'no-restricted-syntax': ['error', ...loggerContentRestrictions],
      'import-x/no-cycle': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-duplicates': 'error',
      // TypeScript already reports unresolved modules and checks named/default imports.
      'import-x/no-unresolved': 'off',
      'import-x/default': 'off',
      'import-x/namespace': 'off',
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-module': 'error',
      'unicorn/no-abusive-eslint-disable': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/prefer-type-error': 'error',
      'unicorn/no-useless-spread': 'error',
      'unicorn/filename-case': [
        'error',
        // `__tests__`-style directories are a test-runner convention, not a naming violation.
        { cases: { kebabCase: true, pascalCase: true }, ignore: [/^__[a-z]+__$/] },
      ],
    },
  },
  boundaries,
  {
    files: ['**/packages/*/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...deepImportPatterns, appImportPattern] }],
    },
  },
  {
    files: CLIENT_FILE_GLOBS,
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [serverEnvImportPath], patterns: deepImportPatterns },
      ],
    },
  },
  {
    // Client modules inside packages keep the package-only app import ban.
    files: CLIENT_FILE_GLOBS.map((glob) => ['**/packages/*/**', glob]),
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [serverEnvImportPath], patterns: [...deepImportPatterns, appImportPattern] },
      ],
    },
  },
  {
    files: PROCESS_ENV_ALLOWED_GLOBS,
    rules: { 'no-process-env': 'off' },
  },
  {
    files: WITHOUT_WORKSPACE_ALLOWED_GLOBS.filter((glob) => !glob.includes('/apps/')),
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  // apps/admin may import `withoutWorkspace`, but like every app no other `@causedeck/db` value (#299).
  ...appDbImportBlocks('**/apps/admin', { withoutWorkspace: false }),
  {
    // Plain JS config files and root-level TS config files are not part of any tsconfig project.
    files: ['**/*.{js,mjs,cjs}', 'vitest.workspace.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Core domains import one another only through `index.ts` along the declared map (#293,
    // docs/engineering/core-domains.md).
    files: ['**/packages/core/src/**/*.{ts,tsx,js,mjs}'],
    plugins: { causedeck },
    rules: { 'causedeck/core-domain-boundaries': 'error' },
  },
);

export default base;
