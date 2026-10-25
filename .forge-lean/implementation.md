### Approach
Rerun recovery: CI test failure was the billing production env fixture missing the new required STATUS_SIGNING_KEY. Added it; reverted an out-of-scope .gitignore change. gitleaks failure is on old history commits (automation handlers.test.ts), unrelated.
### Changes
- packages/billing/src/__tests__/provider-select.test.ts: STATUS_SIGNING_KEY in production fixture
- .gitignore: reverted to base
- Remaining work from earlier runs (status domain, tables, job, env, registries) verified against contract.
### Acceptance Criteria Status
- R1 ✅ packages/core/src/status/publish.ts
- R2 ✅ packages/db/src/schema/status.ts, migrations/20261025050000_status_incident.sql
- R3 ✅ packages/core/src/jobs/definitions/status-publish.ts, packages/config/src/env/schema.ts
- R4 ✅ registries updated (cross-tenant-registry.ts, core-domains.js/md, worker tests, i18n catalog)
- R5 ✅ packages/core/src/status/status.test.ts
### Verification
V1-V6 vitest commands: exit 0. V7 checks.mjs: PASS. billing provider-select test: 7 pass (fails without the fixture fix, as seen in CI). forgedock check: PASS.
### Notes
STATUS_SIGNING_KEY required in production (>=32 chars); any production env fixture needs it.

## Stale-list follow-up
Checked the flagged tests: none enumerate job definitions or db schema exports, so every symbol is recorded under not_members in result.json. No code change needed.

## Merge typecheck failure (turbo: command not found)
Exit 127 was an environment problem, not a code conflict: `turbo` is in node_modules/.bin but was not on PATH. With PATH set, `turbo run typecheck` scoped to core, db, storage, config and i18n passes (16/16 tasks). No code change was needed.

### Post-merge check
Base merged (809117c8). `turbo run typecheck` exit 127 was a missing `turbo` binary on PATH (environment), not a code error; no sibling symbol/key collisions found. Ran `pnpm turbo run typecheck` filtered to core, storage, db, config, i18n, billing, worker (+dependents): 17/17 pass. Post-merge vitest: core status/domains and storage index/keys pass.

Re-verified: with node_modules/.bin on PATH, scoped turbo typecheck (core, db, storage, config, i18n, worker) passes 17/17. lane-check.sh does not exist on this host. No code change.
