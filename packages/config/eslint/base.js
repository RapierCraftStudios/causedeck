// Shared ESLint 9 flat config for every CauseDeck workspace.
import js from '@eslint/js';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { APP_NAMES, boundaries } from './boundaries.js';

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
      'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }],
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
    // Plain JS config files and root-level TS config files are not part of any tsconfig project.
    files: ['**/*.{js,mjs,cjs}', 'vitest.workspace.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
);

export default base;
