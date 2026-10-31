import config from '@causedeck/config/eslint/next';

// `out/` is the static export build output (gitignored); never lint it.
export default [{ ignores: ['out/**'] }, ...config];
