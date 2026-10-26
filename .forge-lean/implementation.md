### Approach
Deterministic consistency checker (#78) as a pure `checkDraft` in `@causedeck/drafting`, schemas in validators, a core service that loads facts through the matter-graph index as the actor and stores one report per (draft version, graph revision), `applyFix` gated on `confirm: true`, and job `drafting.consistency.check`. This session fixed the facts loader (the three graph reads ran concurrently on one transaction and returned empty facts) and the integration test expectations, then cleared type and lint errors.
### Changes
- packages/validators/src/consistency.ts (+test), package.json: Finding/Report/ApplyFix schemas, `./consistency` export.
- packages/drafting/src/consistency/*: extract-entities, match-names, match-case-numbers, match-dates, annexures, check, index (+ unit, static and perf tests).
- packages/core/src/drafting/consistency-service.ts, index.ts, service.ts (`insertVersion` exported): facts, run/get/list/applyFix; integration test.
- packages/core/src/jobs/definitions/drafting-consistency-check.ts, registry.ts; audit/events.ts (`draft.fix_applied`).
- packages/db: `draft_consistency_report` table, migration 20261026000000, schema, registries, seeders; erase.ts and exporters.ts lists.
- Registry tests: worker registry, cross-tenant services, core-domains doc.
### Acceptance Criteria Status
- R1 ✅ packages/drafting/src/consistency/match-names.ts
- R2 ✅ packages/drafting/src/consistency/match-case-numbers.ts
- R3 ✅ packages/drafting/src/consistency/match-dates.ts
- R4 ✅ packages/drafting/src/consistency/annexures.ts
- R5 ✅ packages/validators/src/consistency.ts, check.ts
- R6 ✅ packages/core/src/drafting/consistency-service.ts (applyFix)
- R7 ✅ packages/drafting/src/consistency/__tests__/consistency.test.ts (static test)
- R8 ✅ same file (perf test)
- R9 ✅ packages/core/src/__tests__/cross-tenant/services.test.ts
- R10 ✅ match-names.ts
- R11 ✅ consistency-service.ts (graphRevision), consistency.integration.test.ts
- R12 ✅ applyFix needs `confirm: true`
- R13 ✅ jobs/definitions/drafting-consistency-check.ts
- R14 ✅ job logs counts only; no spans logged
### Verification
- V1 drafting vitest: 61 pass. V2 validators: 11 pass. V3 core drafting/registry/domains/index: 32 pass (failed before the sequential-read fix: 2 integration tests). V4 cross-tenant services: 223 pass. V5 db: 18 pass. V6 worker registry: 9 pass. V7 config boundaries: 40 pass.
- New/updated integration test fails without the fix (empty facts, no order mismatch).
- tsc clean for validators, drafting, core; eslint clean on changed files, prettier applied.
### Notes
No env vars. Both reports of one version share a timestamp inside a single test transaction, so the test accepts either as newest.

## Sibling-list fix
Added no list entries: the db table list already names draft_consistency_report, and the cross-tenant services list already names the new service functions. The other flagged tests do not enumerate these symbols; recorded as not_members in result.json.

## Lint fix
CI lint failed on Prettier formatting in `drafting-consistency-check.ts` and `validators/src/consistency.ts`; ran prettier --write. ESLint on changed files in drafting, validators, core, db and worker is clean.
