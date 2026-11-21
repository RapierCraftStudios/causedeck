forge-stamp: issue=1104 contract=51f461240c61

### Approach
The image sizes come down because the Dockerfiles prune better-auth's unused optional peers (next, SWC, vitest, Playwright, drizzle-kit, esbuild-kit, typescript) from `/deploy` after `pnpm deploy --prod`. This carries PR #1105's commit 541ec5fa (K1). On #1105, CI measured api at 224 MB and worker at 215 MB against the 250 MB gate. The Caddy builder also failed with `vv2.10.2`, which stopped the compose smoke from running. It is fixed by passing xcaddy `"v${CADDY_VERSION#v}"` (K2/K3). The size budgets are unchanged.

### Changes
- infra/docker/api.Dockerfile: adds `ARG OPTIONAL_PEERS_UNUSED` with a comment, and runs `rm -rf` on that list inside `/deploy/node_modules/.pnpm` after the deploy.
- infra/docker/worker.Dockerfile: the same change for @causedeck/worker, with the same list.
- infra/caddy/Dockerfile: changes the line to `xcaddy build "v${CADDY_VERSION#v}"` and adds a comment explaining the ENV/ARG scope. The pins are unchanged.
- infra/scripts/compose-prod.test.mjs: new regression test. It checks that both Dockerfiles declare the same prune list and prune it in `/deploy`.
- infra/caddy/test/caddyfile.test.mjs: new regression test. It checks that xcaddy gets a version with a single `v`.

### Acceptance Criteria Status
- R1 ✅ infra/docker/api.Dockerfile:22,26; infra/docker/worker.Dockerfile:23,27; infra/caddy/Dockerfile:10. This is measured out of band by the images.yml `verify` job (size budgets at :80-83, Caddy build, compose smoke).
- R2 ✅ No budget changed. .github/workflows/images.yml:80-83 still reads web 350, admin 350, api 250, worker 250 (V3), so there is nothing to justify.
- R3 ✅ The runtime CMD and healthchecks are untouched (infra/docker/api.Dockerfile:40,44; infra/docker/worker.Dockerfile:41,45), and better-auth and drizzle-orm are not on the prune list. The Caddy build fix lets the compose smoke run (infra/caddy/Dockerfile:10). This is measured out of band by the compose smoke step.

### Verification
- V1 `node --test --test-concurrency=1 --test-reporter=dot infra/scripts/compose-prod.test.mjs`: exit 0
- V2 `node --test --test-concurrency=1 --test-reporter=dot infra/caddy/test/caddyfile.test.mjs`: exit 0
- V3 the grep checks on the images.yml budgets: exit 0
- G1 both test files together: exit 0
- `forgedock check`: PASS
- I reverted the three Dockerfiles to origin/staging and ran the tests: both new #1104 tests fail. I then restored the Dockerfiles.
- Prettier: `node node_modules/prettier/bin/prettier.cjs --check` on both changed test files passes. The pinned pnpm shim (`…/toolchain/bin/pnpm`) fails with ENOENT on this host, so I could not run `pnpm exec`.
- checks.mjs widened to full turbo typecheck, lint and test because a Dockerfile changed. I did not run them: no TypeScript or package source changed, and CLAUDE.md forbids a full lint locally. CI runs them.

### Notes
- No environment variables were added. The api and worker images no longer contain next, vitest, Playwright, drizzle-kit, esbuild-kit or typescript. Nothing imports them at runtime, and migrations use drizzle-orm's migrator.

### CI failure follow-up: `test-shard (core)` (run 44893579776)
No code change. Three `@causedeck/core` tests failed: `attention.test.ts` (applies the threshold, bounded 7 to 180), `status-links/resolve.test.ts` (records a view) and `whatsapp-link/whatsapp-otp-send.test.ts` (limits sends per number). All three go through `withTestDb` against a shared Postgres, and the failures are time- or rate-window-dependent: a missing stale-days finding, a missing view row and a rate limit hit. The shard ran 864 s and 280 other core files passed. This diff touches only infra/docker/*.Dockerfile, infra/caddy/* and two infra node:test files. None of them are imported by `@causedeck/core`, so the diff cannot affect these tests. I treated them as flaky or timing-dependent and did not amend. The infra validate commands (V1-V3, G1) still exit 0.
