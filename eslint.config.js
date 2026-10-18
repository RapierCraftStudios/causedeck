// Root config: used by the pre-commit hook when linting staged files across workspaces.
import { base } from '@causedeck/config/eslint/base';

export default [
  ...base,
  { ignores: ['packages/config/eslint/__fixtures__/**', 'docs/**', 'research/**'] },
];
