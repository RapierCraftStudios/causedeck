### Approach
Recovery pass for the red `build` check. Admin's Turbopack build failed on the templated `require.resolve` of the PDF fonts in `packages/drafting/src/render/pdf.ts`. The resolver is now a bound function, so the bundler no longer traces it. Everything else from earlier runs was verified against the contract.
### Changes
- packages/drafting/src/render/pdf.ts: font path resolved through a bound `createRequire().resolve`.
- Earlier commits (verified): core drafting service/policy/export/index, `drafting.export` job and registry, `draft_export` table with migration, `draft.read`/`draft.export` policy and matrix, audit action, core-domains config and docs, cross-tenant and worker registry tests, integration test.
### Acceptance Criteria Status
- R1 ✅ packages/core/src/drafting/service.ts
- R2 ✅ packages/core/src/drafting/policy.ts
- R3 ✅ packages/core/src/jobs/definitions/drafting-export.ts
- R4 ✅ packages/core/src/drafting/export.ts
- R5 ✅ packages/core/src/drafting/export.ts
- R6 ✅ packages/core/package.json
- R7 ✅ packages/config/eslint/core-domains.js, docs/engineering/core-domains.md
- R8 ✅ packages/db/src/testing/cross-tenant-registry.ts, packages/core/src/__tests__/cross-tenant/services.test.ts
- R9 ✅ packages/core/src/drafting/__tests__/drafting.integration.test.ts
- R10 ✅ service.ts and export.ts never log draft text
### Verification
- V1 checks.mjs: exit 0.
- V2 core vitest: pass (services file run alone, 218 tests).
- V3 db vitest: exit 0.
- V4 auth vitest: exit 0.
- V5 worker vitest: exit 0.
- V6 schema conventions and migration lint: exit 0.
- Drafting package vitest: 15 pass. The Next build is CI-only, so the build fix has no local test and fails_without_fix is unknown.
### Notes
No behaviour change from the pdf.ts edit. The Security check fails on historical gitleaks findings in unrelated test files, not on this branch's changes.

## Stale-list fix
The 20 flagged (symbol, test) pairs are not members: none of the 10 tests names the sibling exports (DRAFT_STATUSES, draft, draftVersion); the flagged lines are unrelated mock state or fixtures. Recorded in result.json `not_members`.
