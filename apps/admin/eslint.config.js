import { appDbImportBlocks } from '@causedeck/config/eslint/boundaries';
import next from '@causedeck/config/eslint/next';

// The base config's apps/admin blocks match repo-root paths (the pre-commit hook lints from the
// root). `eslint .` here sees paths relative to apps/admin, so repeat them: no `@causedeck/db` value
// import (#299) and no `withoutWorkspace`, except in the audited data layer (`lib/data`, #309).
export default [
  ...next,
  ...appDbImportBlocks('**', { withoutWorkspace: true }),
  ...appDbImportBlocks('lib/data', { withoutWorkspace: false }),
];
