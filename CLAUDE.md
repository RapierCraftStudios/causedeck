# CauseDeck — agent notes

## Local verification (D-045 sweet-spot CI)

The build host has 4 cores shared by many parallel lanes. Verify only what your change can affect; CI runs the full suites.

- Typecheck / unit tests: `bash /home/dev/.forge/causedeck-chain/lane-check.sh typecheck` and `… test` (changed packages plus dependents, shared turbo cache). Outside that host: `pnpm turbo run typecheck test --filter='...[origin/<base>]'`.
- Lint only the files you changed: `pnpm exec eslint <files>` (the pre-commit hook already does this). Do not run `eslint .` or repo-wide `pnpm typecheck` / `pnpm test`.
- Run a single package's tests with `pnpm --filter <pkg> exec vitest run <path>` while iterating.
- Never run locally: Playwright e2e, Storybook / visual tests, Lighthouse, `next build`. They run in CI (ship PRs and nightly).
