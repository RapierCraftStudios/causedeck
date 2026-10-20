# CauseDeck — agent notes

## Local verification (D-045 sweet-spot CI)

The build host has 4 cores shared by many parallel lanes. Verify only what your change can affect; CI runs the full suites.

- Typecheck / unit tests: `bash /home/dev/.forge/causedeck-chain/lane-check.sh typecheck` and `… test` (changed packages plus dependents, shared turbo cache). Outside that host: `pnpm turbo run typecheck test --filter='...[origin/<base>]'`.
- Lint only the files you changed: `pnpm exec eslint <files>` (the pre-commit hook already does this). Do not run `eslint .` or repo-wide `pnpm typecheck` / `pnpm test`.
- Run a single package's tests with `pnpm --filter <pkg> exec vitest run <path>` while iterating.
- Never run locally: Playwright e2e, Storybook / visual tests, Lighthouse, `next build`. They run in CI (ship PRs and nightly).

## Registries and expected lists (update in the same PR)

CI's guard tests fail when something new isn't registered. Most needs-human lanes so far came from these lists:

| You added | Also update |
| --- | --- |
| A runtime export of `@causedeck/core` (function, constant, class) | `packages/db/src/testing/cross-tenant-registry.ts`: `SERVICE_TESTS` with a real case in `packages/core/src/__tests__/cross-tenant/services.test.ts` (B on A is denied or sees nothing; A is unchanged), or `NOT_A_SERVICE` with a reason |
| A `'use server'` action in `apps/web` | `ACTIONS` and the probe inputs in `apps/web/__tests__/cross-tenant-actions.test.ts` |
| A table | `packages/db/src/index.test.ts` (root table list); if it has `workspace_id`: the RLS catalog in `packages/db/src/__tests__/rls/sql.test.ts`, `TABLE_TESTS`/registry and the two-tenant seeders |
| A job or schedule | `apps/worker/src/__tests__/registry.test.ts` and `schedules.test.ts` |
| An i18n namespace | `packages/i18n/src/__tests__/catalog.test.ts` |
| A core domain or cross-domain import | `CORE_DOMAIN_DEPENDENCIES` and `docs/engineering/core-domains.md`; import other domains only through their `index.ts` |
| A migration | Use the next free number on the milestone branch; if the base took it, renumber (same SQL, regenerated snapshot) |

Test fixtures must use valid domain values (e.g. usage keys match `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$`: no UUID hyphens).
