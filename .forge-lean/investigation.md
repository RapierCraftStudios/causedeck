**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (feature; no live defect, the status page in #96 has no data source yet)
**Task Type**: feature

### What Was Claimed
Part 1 of #96: a `packages/core/src/status` domain (zod model, sanitised HMAC-signed snapshot built from health checks and `getAdapterHealthSummary` with documented thresholds), platform tables `incident` and `incident_update` (no `workspace_id`) with a migration, a worker job `status.publish` (every minute, idempotent, overlap-safe, writes `status/status.json` through the S3 abstraction), a `STATUS_SIGNING_KEY` env var with a dev default, and every shared registry pre-staged. Siblings #770 (admin incident console), #771 (public page) and #772 (e2e) consume it.

Note: the earlier "Investigation Report" comment on the issue (WhatsApp link UI) and the `.forge-lean/*` files found in the tree describe a different issue. They were ignored and overwritten.

### What We Found
(verified on `origin/milestone/site-onboarding-launch`, 8c2520a3)
- Nothing exists yet: no `packages/core/src/status`, no `StatusSnapshot`, no `STATUS_SIGNING_KEY`, no `incident` table (git grep of the base).
- Adapter data source: `packages/core/src/court/adapter-health.ts:20` `getAdapterHealthSummary(db)` returns per adapter and version `runs/okRuns/degradedRuns/failedRuns` (view `adapter_health_summary`, names no workspace). Thresholds must be derived from these counts.
- Naming clash to avoid: `system.status.poll` already exists (case-watch, `packages/core/src/jobs/definitions/status-poll.ts`, registered in `apps/worker/src/__tests__/registry.test.ts:171`, `schedules.test.ts:46`). The new job must be `system.status.publish` (system jobs start `system.`, `packages/core/src/jobs/define.ts:90`, payload `workspaceId` null/optional).
- Job precedent: `packages/core/src/jobs/definitions/notices-poll.ts:79` (`defineJob`, `concurrency: 1`, `singleton: { policy: 'stately' }`, `schedule: { cron, payload: {} }`); registered in `packages/core/src/jobs/registry.ts:47,210,270` and exported at `packages/core/src/jobs/index.ts:157`. Schedules run in Asia/Kolkata (`apps/worker/src/schedules.ts:5`), irrelevant for `* * * * *`.
- Platform-table precedent: `notice` is in `GLOBAL_TABLES` (`packages/db/src/conventions.ts:46,80`), listed in the root table test (`packages/db/src/index.test.ts:121`), schema in `packages/db/src/schema/notices.ts`, exported from `packages/db/src/schema/index.ts:298`. Tables without `workspace_id` must be in `GLOBAL_TABLES`, with a justification comment. They need no RLS catalog entry (`packages/db/src/__tests__/rls/sql.test.ts` lists only tenant tables).
- Latest migration is `20261025040000_whatsapp_inbound` (`packages/db/migrations/meta/_journal.json:695`); next free is `20261025050000`.
- Storage: `ObjectStore` (`packages/storage/src/provider.ts:92`) accepts only branded `ObjectKey`, and the only builder `objectKey()` (`packages/storage/src/keys.ts:47`) produces `ws/<uuid>/<kind>/<yyyy>/<uuid>`; `parseObjectKey` (`keys.ts:67`) rejects anything else. `status/status.json` therefore cannot be written today: a small public-key seam is needed in `@causedeck/storage` (providers must be checked to accept it). `@causedeck/core` already depends on `@causedeck/storage` (`packages/core/package.json:70`), jobs use `createObjectStoreFromEnv` (`jobs/definitions/capture-retention.ts:10`), so no new workspace dependency.
- Env: secrets with dev defaults follow `BETTER_AUTH_SECRET` (`packages/config/src/env/schema.ts:22,150-154`, `secret: true`, `devDefault`); `.env.example` is generated from the specs (`packages/config/src/env/example.ts`), and `packages/config/src/env/__tests__/*` assert it.
- Registries to pre-stage (CLAUDE.md table): core domains `packages/config/eslint/core-domains.js:51` (`CORE_DOMAIN_DEPENDENCIES`) plus `docs/engineering/core-domains.md` (rows ~23-30, mermaid ~166, dependency table ~225); core barrel `packages/core/src/index.ts:9`; `packages/core/package.json:37` exports (add `./status`); cross-tenant `NOT_A_SERVICE`/`SERVICE_TESTS` in `packages/db/src/testing/cross-tenant-registry.ts:209,872` (`getAdapterHealthSummary` is tested at `services.test.ts:1863` as a model); worker `registry.test.ts:168`, `schedules.test.ts:43,115`; i18n `packages/i18n/src/catalog.ts:7` `NAMESPACES` and `catalog.test.ts:~113`.
- Court wording: "Parsing of documents you share" appears nowhere on the base; it must be the display label for the court/adapter component.

### Root Cause
Missing feature: #96 was closed not_planned; the status page milestone work has no data layer. The signed snapshot, incident tables and publisher are the shared base for #770/#771/#772.

### Affected Files
- new `packages/core/src/status/{index,model,publish,thresholds,sanitise}.ts` + tests
- new `packages/core/src/jobs/definitions/status-publish.ts`; edit `jobs/registry.ts`, `jobs/index.ts`
- `packages/core/src/index.ts`, `packages/core/package.json`
- new `packages/db/src/schema/status.ts`; `schema/index.ts`; `conventions.ts`; `index.test.ts`; new migration `20261025050000_status_incident.sql` + meta snapshot/journal
- `packages/storage/src/keys.ts` (+ providers if they validate keys), `packages/storage/src/index.ts`
- `packages/config/src/env/schema.ts` (+ `.env.example`), `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`
- `packages/db/src/testing/cross-tenant-registry.ts`; `apps/worker/src/__tests__/{registry,schedules}.test.ts`
- `packages/i18n/src/catalog.ts`, `messages/{en,kn,ta}/status.json`, `__tests__/catalog.test.ts`, regenerated `generated/**`

### Sibling Sweep
Other global (non-tenant) tables, `notice` (#584) and `adapter_health_summary`, follow the `GLOBAL_TABLES` route. The only same-name risk is `system.status.poll` and the case-watch `status` wording, so the new domain dir and job use `status`/`status.publish` but the registry text must be explicit. No other publisher writes to a public path.

### History
No prior status-page implementation. `getAdapterHealthSummary` came with #372 (ADR 0015) and was explicitly meant for "the status page (#42)". #96 closed not_planned.

### Recommendation
Implement as in `contract.json`: snapshot model and pure threshold mapping (documented constants), sanitiser as an allowlist projection (never copies free text from health errors), HMAC-SHA256 over canonical JSON with `STATUS_SIGNING_KEY`, `publishStatus` that skips the write when the content hash is unchanged (idempotent) and exposes staleness detection (`isStale(snapshot, now, maxAgeSec)`), job `system.status.publish` cron `* * * * *` singleton stately.

### Related Issues
#96 (parent), #770, #771, #772 (siblings, consumers), #372 (adapter health), #586 (notices precedent).
