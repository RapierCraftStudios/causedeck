**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; no live defect)
**Task Type**: feature

### What Was Claimed
Part 3 of #75: add the `packages/core/src/drafting` domain (service, policy, index), the idempotent `drafting.export` job, storage and audit of exports, registries, and a testcontainers integration test. Depends on #766 (data layer) and #767 (engine), both merged.

### What We Found
- No `packages/core/src/drafting` and no `drafting-export.ts` job exist (`ls packages/core/src`, `packages/core/src/jobs/definitions`); `@causedeck/drafting` is not in `packages/core/package.json` dependencies (only `apps/web/package.json:56`); no `./drafting` export (`packages/core/package.json` exports list).
- Engine is merged and pure: `packages/drafting/src/index.ts` exports `renderDocx`, `renderPdf`, `resolveBlocks`, `exportBlockers`, `MissingSlotsError`, `PdfTooLargeError`, `draftNarrative`, `Facts` (`slots.ts:7`: matter title/cnr/court, parties, hearing nextDate/bench, advocate, workspace, today).
- Data layer: `packages/db/src/schema/drafting.ts` has `template`, `draft`, `draft_version` (immutable by trigger; only `created_by` may go to null). There is NO table or column for an export: `exported_at` and the stored file key need a new tenant table (e.g. `draft_export`, unique `(draft_version_id, format)`), so this change needs a migration. A column on `draft_version` is impossible (immutability trigger).
- Policy: `packages/auth/src/policy/actions.ts:14` has only `draft.write`; matrix `matrix.ts:30` gives `junior`, and `JUNIOR_MATTER_SCOPED` (`matrix.ts:52`) includes it. Clerks (rank 1) are therefore denied. Read and export actions do not exist; the issue's `can(user,'draft:*')` needs `draft.read` and `draft.export` added (generated `docs/engineering/permissions.md` via `pnpm docs:permissions`).
- Audit: actions are a registry in `packages/core/src/audit/events.ts` (e.g. `export.requested` at :159); `record()` in `audit/writer.ts` runs on the caller's tx. A `draft.exported` action (metadata: format, version hash) must be added. ai_call rows for refused calls are already written by the gateway (`packages/ai/src/gateway.ts:8,142`) via `createAiPorts` (`packages/core/src/ai/wiring.ts`); the job must run narrative calls through that and test that a non-India refusal writes an `ai_call` row.
- Storage: `@causedeck/storage` `ObjectStore.put/presignGet`, kind `export` already exists (`packages/storage/src/limits.ts:13`), keys `ws/<workspaceId>/export/<yyyy>/<id>` (`keys.ts:1`). Envelope-encrypted put and download pattern: `lifecycle/export/*` and `jobs/definitions/export-build.ts` (`createObjectStoreFromEnv`, `EnvKeyProvider`), `createDownloadUrl` (`storage/src/download.ts`).
- Job pattern: `defineJob` with `singleton`, `idempotencyKey`, registry entry in `packages/core/src/jobs/registry.ts:48,187,247`; worker list asserted in `apps/worker/src/__tests__/registry.test.ts:145`.
- Matter facts: `matter-graph` domain (`packages/core/src/matter-graph/index.ts`, `next-date.ts` `getCanonicalNextDate`); research notes service `research/notes-service.ts:1-60` is the access pattern (`can`, `matterVisibilityPredicate`, `forbidden/notFound`).
- Registries: `packages/config/eslint/core-domains.js:87` (`CORE_DOMAIN_DEPENDENCIES`), `docs/engineering/core-domains.md` (tables near :42, :127, :242, :255), `packages/db/src/testing/cross-tenant-registry.ts` (SERVICE_TESTS near :850; table map near :81 has `draft`, `draft_version`), `packages/db/src/index.test.ts:145` and `packages/db/src/__tests__/rls/sql.test.ts:210` for a new table.
- `packages/core/src/__tests__/cross-tenant/services.test.ts` is a 3619-line hotspot.

### Root Cause
Missing feature: the engine exists but nothing in core loads facts, persists versions, enforces policy or exports with storage and audit.

### Affected Files
`packages/core/src/drafting/{service,policy,index}.ts` (+ export helper, tests, `__tests__/drafting.integration.test.ts`), `packages/core/src/jobs/definitions/drafting-export.ts`, `jobs/registry.ts`, `packages/core/package.json`, `packages/core/src/index.ts`, `packages/db/src/schema/drafting.ts` + new migration/snapshot, `packages/auth/src/policy/{actions,matrix}.ts` + permissions doc, `packages/core/src/audit/events.ts`, `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/db/src/{index.test.ts,__tests__/rls/sql.test.ts}`, `apps/worker/src/__tests__/registry.test.ts`, `pnpm-lock.yaml`.

### Sibling Sweep
Same lane precedents: research (#80) added a domain plus tables with the same registry set; `export.build` is the closest job/storage/audit precedent. Audit-action and policy-action registries have generated docs/guard tests (`packages/auth/src/policy/__tests__`, audit events tests) that must be updated together.

### History
#766 (PR #785) data layer, #767 engine (merge 9525e08c). No earlier core drafting work. Parent #75 closed not_planned (split).

### Recommendation
Implement per `contract.json`: new `draft_export` tenant table; policy actions `draft.read`/`draft.export`; service + job; keep new logic out of `services.test.ts` beyond a small wiring (put cross-tenant drafting cases in a new file referenced from the registry if it supports a per-entry test path, as `LIFECYCLE_TEST` does).

### Related Issues
#75 (parent), #766, #767 (done), #76 (system templates), #80 (research domain precedent).
