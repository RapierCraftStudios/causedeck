### Approach
Continued the checkpointed work (public-api core domain, four key-scoped v1 routes, registries). This session made the tests runnable, fixed what they exposed, and formatted and linted.
### Changes
- All contract deliverables D1-D14 (see `git diff origin/milestone/court-data-network...HEAD`).
- apps/api/openapi/v1.json: regenerated with `pnpm openapi:export`; the committed-spec test requires it (amendment add-deliverable).
- apps/api/src/__tests__/api-keys.test.ts: probe routes moved to `/cases/probe/ping` and `/orders/probe/ping`, because `/v1/cases/probe` now matches the real `/cases/{cnr}` route (422).
- apps/api/src/__tests__/public-api.test.ts: seeds the watch that owns the snapshot (`case_status_snapshot.watchId`), and a lint fix.
### Acceptance Criteria Status
R1-R7 ✅ (routes `apps/api/src/public/v1/*.ts`, domain `packages/core/src/public-api/index.ts`, test `apps/api/src/__tests__/public-api.test.ts`). R8 deferred per contract.
### Verification
- V1 (api: public-api, api-keys, cross-tenant, openapi, static-guards): 70/70 pass.
- V2 (core: cross-tenant services, public-api, sources): 198/198 pass.
- V3 (db): `src/testing` holds no test files; `src/__tests__/cross-tenant/registry.test.ts` passes 4/4.
- V4 (admin): 32/32 pass.
- tsc in core and api pass. Prettier and eslint pass (pre-commit hook).
- public-api.test.ts fails without the fix: the routes do not exist, so every request is a 404.
- The sandbox host's node is 22.12.0, which has no `zlib.createZstdDecompress` (needed by undici 8), and testcontainers cannot see Postgres start. I ran the same test files with a scratch zstd preload and a scratch global setup in $TMPDIR (labelled docker postgres, same init SQL and migrations). `forgedock check` itself still fails on this host for that reason, not because of the code.
### Notes
No env vars, no behaviour change for existing routes.

## Merge-check fix
The reported failure (`turbo: command not found`, exit 127) is a host PATH problem, not a code conflict. Per-package `tsc --noEmit` on core, db and api passes on the merged tree, so no symbols needed renaming. Vitest cannot start on this host (Node 22.12 with undici 8.12.1 throws in `decompress.js`, even for the untouched errors.test.ts), so V1-V4 were not re-run after the merge.

### Post-merge check (base merged, 533acbcf)
`turbo run typecheck` exited 127 because bare `turbo` is not on PATH, not because of the code. After the merge, `pnpm exec turbo run typecheck --filter=@causedeck/api --filter=@causedeck/core --filter=@causedeck/db` passes (17/17 tasks), and `tsc --noEmit` passes in core, db, api and admin. There were no duplicate keys or same-named symbols. The api test suites pass after the merge (18 files, 152 tests).

## Lint fix
CI lint failed on `z.string().date()` (deprecated, no-deprecated) in apps/api/src/public/v1/causelists.ts; switched to `z.iso.date()`. Same OpenAPI output (format: date). ESLint on changed api/core files is clean; api tsc clean. Vitest could not run in this shell (undici/Node 22.12 load error, environmental).

## CI test failure (@causedeck/intelligence#test)
No code change. `@causedeck/intelligence` does not depend on `@causedeck/core` and this branch changes nothing under packages/intelligence, so the branch cannot affect it. The CI log shows only the tail with no failing test id, in a cold (0 cached) 17-task shard. The package passes here: 37 files, 307 passed, 1 skipped. The failure looks like a load-dependent timeout flake on the shared runner (its PDF/font tests have a 30 s timeout set for that reason). A CI rerun is the next step.
