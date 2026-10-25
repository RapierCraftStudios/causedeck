// Root config: used by the pre-commit hook when linting staged files across workspaces.
import { causedeck } from '@causedeck/config/eslint/authorization';
import { base } from '@causedeck/config/eslint/base';

export default [
  ...base,
  {
    ignores: [
      'packages/config/eslint/__fixtures__/**',
      // Docs are prose, except the ADR tooling scripts in docs/adr/scripts.
      'docs/*',
      '!docs/adr/',
      'docs/adr/scripts/__fixtures__/**',
      'research/**',
      // Node-test files run with --experimental-strip-types and sit outside every tsconfig (#102).
      'infra/monitoring/test/**',
    ],
  },
  {
    // Server actions and `/v1` routes must authorize (#235), as in the web and api configs.
    files: ['apps/web/**/*.{ts,tsx}', 'apps/api/src/routes/v1/*.ts'],
    plugins: { causedeck },
    rules: { 'causedeck/require-authorization': 'error' },
  },
];
