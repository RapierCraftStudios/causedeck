// packages/core lint: the shared Node config plus the court-hostname ban (#34, ADR 0014). Official
// court hostnames are catalogue data (packages/db/src/seed/forum-catalogue, `forum.config.hosts`):
// they move between domains, so no core code or test may spell one.
import { loggerContentRestrictions } from '@causedeck/config/eslint/base';
import node from '@causedeck/config/eslint/node';

const COURT_HOST =
  '(^|[^a-z0-9-])([a-z0-9-]+\\.)*(tn\\.gov\\.in|karnataka\\.gov\\.in|nclt\\.gov\\.in)';
const COURT_HOST_MESSAGE =
  'Court hostnames are catalogue data (packages/db/src/seed/forum-catalogue); read them from forum.config.hosts.';

export const courtHostRestrictions = [
  `Literal[value=/${COURT_HOST}/i]`,
  `TemplateElement[value.raw=/${COURT_HOST}/i]`,
].map((selector) => ({ selector, message: COURT_HOST_MESSAGE }));

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...node,
  {
    files: ['**/*.ts'],
    rules: {
      // Keep the shared logger-content restrictions: this list replaces the base one.
      'no-restricted-syntax': ['error', ...loggerContentRestrictions, ...courtHostRestrictions],
    },
  },
];
