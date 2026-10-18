// Root config: used by the pre-commit hook when linting staged files across workspaces.
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
    ],
  },
];
