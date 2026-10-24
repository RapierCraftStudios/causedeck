### Approach
Followed the frozen contract: new tenant tables modelled on `case_watch` and `webhooks`, a new `institution` workspace kind in the DB only, one migration with FORCE RLS, and the registration lists.

### Changes
- packages/db/src/schema/portfolio.ts: `portfolio`, `portfolio_case`, `portfolio_panel_advocate` via `tenantTable()`.
- packages/db/src/schema/index.ts: exports.
- packages/db/src/schema/auth.ts: `'institution'` in `WORKSPACE_KINDS`.
- packages/db/migrations/20261024110000_portfolio.sql, meta/_journal.json (idx 87), meta/20261024110000_snapshot.json: tables, FKs, kind check re-added, ENABLE/FORCE RLS and `ws_isolation`.
- packages/db/src/index.test.ts, src/__tests__/rls/sql.test.ts, src/testing/cross-tenant-registry.ts, src/testing/two-tenants.ts (three seeders), src/__tests__/auth-schema.test.ts: registrations.
- packages/db/src/__tests__/portfolio-schema.test.ts: new schema test.

### Acceptance Criteria Status
- R1 ✅ packages/db/src/schema/portfolio.ts:20-110
- R2 ✅ packages/db/src/schema/auth.ts:44, migration kind check
- R3 ✅ migrations/20261024110000_portfolio.sql (RLS statements at end)
- R4 ✅ index.test.ts, rls/sql.test.ts, cross-tenant-registry.ts, two-tenants.ts
- R5 ✅ the generic cross-tenant SQL suite runs per registered table and passes with the new seeders

### Verification
- V1 (schema, auth, index, conventions, lint-migrations tests): pass. The new test fails without the change (imports the missing portfolio.ts).
- V2 (rls and cross-tenant suites, 144 tests): pass.
- V3 `db:check`: pass.
- `tsc --noEmit` for @causedeck/db and eslint on changed files: clean.

### Notes
- No behaviour change for existing kinds; validators and UI still offer solo and chamber only.
- No env vars. scripts/check-devdocs-freshness.sh does not exist in this repo.

### Stale-list follow-up
The 30 flagged (symbol, test) pairs are not members: none of the 10 tests lists @causedeck/db schema tables (flagged lines are hoisted mock state or fixtures; the db mocks only expose db/withWorkspace/withoutWorkspace). Recorded under `not_members` in result.json; no test edits needed.

## Merge-check fix (turbo exit 127)
The merged-tree failure was `turbo: command not found` (bare `turbo` not on PATH), not a symbol/key conflict. No source change needed. Re-verified on the merged tree: `pnpm exec turbo run typecheck --filter='...[base]'` 23/23 pass; V1 (45 tests), V2 (144 tests), V3 db:check all pass.

### Merge recheck
Typecheck failure after the base merge was exit 127 `turbo: command not found` (turbo is not on PATH on this host; a toolchain problem, not a code defect). `pnpm exec turbo run typecheck --filter='...[41ce83bd]'` passes 23/23. No duplicate keys or symbols found; no code change. V1-V3 re-run and pass.
