### Approach
Fact-check service over the pure `@causedeck/drafting` engine: facts read through matter-graph as the actor for the draft's own matter, verdicts stored as `draft_fact_ack` rows, per-matter ignore/assertion decisions, and an audited acknowledgement that the export gate honours.

### Changes
- packages/core/src/drafting/factcheck-service.ts: loadFactCheckFacts, runFactCheck, ignoreForMatter, markAsAssertion, recordFactFix, openFactBlockers
- packages/core/src/drafting/citation-ack.ts: exportBlockedByFactCheck, assertFactCheckClear, acknowledgeFactCheck (audited)
- packages/core/src/drafting/export.ts, service.ts: gate called next to the citation gate
- packages/core/src/drafting/index.ts: exports
- packages/db/src/schema/drafting.ts, schema/index.ts, migrations 20261027183230: table draft_fact_ack with RLS
- packages/validators/src/factcheck.ts (+package.json export): zod inputs
- apps/web/.../drafts/[id]/factcheck-actions.ts: server actions
- cross-tenant registry, core services.test.ts, web cross-tenant-actions.test.ts, db index/rls/two-tenants: registrations
- core audit events, lifecycle erase/export: new action names and table
- packages/core/src/drafting/__tests__/factcheck-service.test.ts: new tests
- docs/engineering/core-domains.md: describes the new functions

### Acceptance Criteria Status
- R1 ✅ factcheck-service.ts (loadFactCheckFacts)
- R2 ✅ factcheck-service.ts (ignoreForMatter)
- R3 ✅ factcheck-service.ts (markAsAssertion, records userId)
- R4 ✅ factcheck-service.ts (recordFactFix, draft.factcheck.fixed)
- R5 ✅ citation-ack.ts (exportBlockedByFactCheck, acknowledgeFactCheck), export.ts, service.ts
- R6 ✅ factcheck-actions.ts
- R7 ✅ cross-tenant-registry.ts, services.test.ts, cross-tenant-actions.test.ts, core-domains.md

### Verification
- V1 as written (`-q`): exit 1, vitest 3.2.7 rejects `-q` ("Unknown option"). With `--reporter=dot` instead: 7 files, 35 tests pass.
- V2 as written (`-q`): exit 1, same cause. With `--reporter=dot`: 23 files, 205 tests pass.
- V3: passes (but the typecheck/lint/test it prints were widened to full turbo runs by the validators package.json change; not run locally per CLAUDE.md). `tsc --noEmit` on @causedeck/core is clean.
- New test failing without the fix: not run (unknown).

### Notes
No env vars. Behaviour change: exports of a fact-checked version are blocked (CONFLICT) until findings are ignored, asserted or acknowledged. Contract defect: V1/V2 use `-q`, unsupported by the pinned vitest.
