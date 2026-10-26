### Approach
Drafting domain in `@causedeck/core` over the pure `@causedeck/drafting` engine: policy (matter visibility + `draft.read|write|export`), service (versions with canonical-JSON sha256), export body and a `drafting.export` job. A new `draft_export` table (draft_version is immutable) holds the stored file, `exported_at` and the idempotency key `(draft_version_id, format)`.

### Changes
- packages/core/src/drafting/{policy,service,export,index}.ts: access, createDraft/renderDraft/saveVersion/listVersions/restoreVersion/exportDraft, runDraftingExport, createDraftExportDownload (presigned GET only).
- packages/core/src/jobs/definitions/drafting-export.ts, jobs/registry.ts: job `drafting.export`.
- packages/core/package.json, src/index.ts, pnpm-lock.yaml: `@causedeck/drafting` dependency, `./drafting` export.
- packages/auth/src/policy/{actions,matrix}.ts (+ can test, snapshot): `draft.read`, `draft.export` (junior, matter-scoped); `draft.write` unchanged.
- packages/core/src/audit/events.ts: `draft.exported`.
- packages/db: `draft_export` schema, migration 20261025225346, tests/registries/seeders.
- packages/config/eslint/core-domains.js, docs/engineering/{core-domains,permissions}.md: domain wiring.
- packages/db/src/testing/cross-tenant-registry.ts + core cross-tenant services.test.ts: 8 SERVICE_TESTS cases (B on A denied, A unchanged).
- packages/core/src/drafting/__tests__/drafting.integration.test.ts: integration test.
- apps/worker/src/__tests__/registry.test.ts: `drafting.export`.

### Acceptance Criteria Status
- R1 ✅ packages/core/src/drafting/service.ts
- R2 ✅ packages/core/src/drafting/policy.ts, packages/auth/src/policy/matrix.ts:30
- R3 ✅ packages/core/src/jobs/definitions/drafting-export.ts, export.ts (existing-row return)
- R4 ✅ packages/core/src/drafting/export.ts (storeSystemBlob kind export, createDownloadUrl)
- R5 ✅ export.ts `draft.exported` audit, `exported_at`; narratives via core AI gateway
- R6 ✅ packages/core/package.json
- R7 ✅ packages/config/eslint/core-domains.js, docs/engineering/core-domains.md
- R8 ✅ packages/db/src/testing/cross-tenant-registry.ts, services.test.ts (draftingCases), worker registry.test.ts
- R9 ✅ packages/core/src/drafting/__tests__/drafting.integration.test.ts
- R10 ✅ logs carry ids/format/size; asserted in the integration test

### Verification
- V1 checks.mjs: prints scoped commands (widened by package.json); typecheck of core `tsc --noEmit` clean; eslint on changed files clean (pre-commit hook).
- V2 core vitest (drafting, domains, jobs registry, cross-tenant registry + services): pass (services.test.ts 218 passed in 478 s under host load). `forgedock check` times out on V2 at its 300 s cap, because services.test.ts alone takes ~480 s on the contended host.
- V3 db index + rls sql: pass. V4 auth policy: pass. V5 worker registry/schedules: pass. V6 schema conventions + migration lint: pass.
- New tests fail without the fix: the modules, table and registrations do not exist.

### Notes
- Job payload also carries `userId` (audit actor and facts reader).

## Sibling-list follow-up
The 20 flagged (symbol, test) pairs for DRAFT_EXPORT_FORMATS and draftExport are unrelated mocks or fixtures at the cited lines, not lists of db schema exports. They are recorded in result.json not_members; no test edits.

## Name-collision follow-up
Renamed drafting's `exportFilename` to `draftExportFilename` (export.ts) and `canonicalJson` to `canonicalDraftJson` (service.ts); neither is exported from the drafting index or core index, so the existing lifecycle registry entries stay unchanged. Core typecheck clean; domains test run.

## Conformance fix (R5, R9)
- Integration test: refused non-India narrative call (`ResidencyViolationError`, `ai_call` row with status `residency_violation`, no export row); clerk denied on `exportDraft` and `createDraftExportDownload` (FORBIDDEN).
- New `packages/core/src/drafting/__tests__/policy.test.ts`: role matrix for `draft.read/write/export` and the matter-less path.
