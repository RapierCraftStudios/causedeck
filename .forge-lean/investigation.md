**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield backend half of #81; no defect)
**Task Type**: feature

### What Was Claimed
Backend half of #81 (M5 playbooks and precedent bank). Add layer M5 to `packages/validators/src/memory.ts` and the `memory_item` CHECKs; add `precedent_passage` (migration, RLS, clerk denial, chamber sharing only when the owner shared); `packages/core/src/memory/m5/{playbook,precedent-bank,proposals}.ts`; `packages/ai/src/embeddings.ts` (India-only route, mock embedder, non-India providers refused and audited, static no-fine-tuning test); embedding deletion within 24h with a test; flag `m5_playbooks` (default off, on for demo workspace); an ADR; registries; `packages/core/test/memory-m5.integration.test.ts`. Acceptance: criteria 1-6 and 13 of #81.
Note: the earlier "Investigation Report" comment on #901 describes the drafts list page (a different issue); it does not apply and is ignored.

### What We Found
- `packages/validators/src/memory.ts:11` `MEMORY_LAYERS = ['M1','M2','M3','M4','M6','M7']`, no M5; `LAYER_SCOPES` at :28-35; keys registry `MEMORY_KEYS` from :40 (header comment :4 says M5 is #81).
- `packages/db/src/schema/memory.ts:38` duplicate `MEMORY_LAYERS` list; CHECKs `memory_item_layer_chk` :99 and `memory_proposal_layer_chk` (:133); `memory_item_layer_scope_chk` :104 (`(layer='M3') = (scope='matter')`) already permits M5 with user/workspace scope; `memory_item_shared_chk` :106 allows `shared_with_chamber` only for M4, so M5 chamber sharing needs it widened to `layer in ('M4','M5')`.
- `packages/db/migrations/20261026074215_memory.sql`: RLS `ws_isolation`, RESTRICTIVE `memory_item_owner_scope` (user-scope visible to owner unless `shared_with_chamber`), `memory_clerk_readable(layer,strategy)` allows only M1,M2,M6,M7 so clerks already cannot read M5 through the view; clerk role has no grant on `memory_item`/`memory_embedding`. A new table needs its own REVOKE for clerk. Latest migration is `20261027114504_authority.sql` (121 files in `packages/db/migrations`; `db:generate` stamps and writes `meta/` snapshot).
- `packages/db/src/schema/memory.ts:~170` `memory_embedding` (item_id FK to memory_item, `matter_id` nullable, `embedding` vector(1024), hnsw index) is reusable for M5 passages (matter_id null).
- `packages/core/src/memory/embedding.ts:25-30,40-50` `MemoryEmbedder` with `region local|india|other`, `localMemoryEmbedder` (hashing mock), `assertEmbedderAllowed` refuses `other` but does NOT audit the refusal; `embedMemoryItem` only embeds M3 (:76-80 returns false otherwise); `searchMatterMemory` is matter-only. `purgeDeletedMemoryEmbeddings` (:150-160) deletes embeddings of `status='deleted'` items; `purgeMemoryTargets` uses `app_memory_purge_targets()` (hourly `memory.purge`, `apps/worker/src/__tests__/registry.test.ts:154-158`). A deleted M5 item is therefore already purged by the existing job; no new job needed, but a test for M5 is required.
- `packages/core/src/memory/propose.ts` and `confirm.ts` (`confirmMemory` is the only writer of `memory_item`, `confirm.ts`), `scope.ts:41` `MEMORY_CLERK_LAYERS`, `scope.ts` role gates; `audit` via `record` (`confirm.ts:17`). Dismissal rest today is 60 days for edit proposals (`docs/engineering/core-domains.md:23`); M5 needs a reason code and a 30-day no-re-proposal window.
- `packages/ai/src` has no `embeddings.ts`; `packages/ai/src/policy/residency.ts:8-23` has `INDIA_REGIONS`, `isIndiaRegion`, India-only chain filter; `packages/ai/src/__tests__/static-checks.test.ts` is the pattern for static guards (scans `providers/`). Providers: bedrock, sarvam, mock, synthetic.
- Flags: `packages/flags/src/keys.ts` `FLAGS` registry (all default false, `flag(key, desc, legalGated, owner)`); workspace override table `workspace_feature_flag` (`packages/db/src/schema/flags.ts`); demo seed `packages/db/src/seed/demo/index.ts` currently seeds no flag overrides.
- Registries/enumerating tests: tables list `packages/db/src/index.test.ts:132-136`; RLS catalog `packages/db/src/__tests__/rls/sql.test.ts:192-197`; `packages/db/src/testing/cross-tenant-registry.ts:194-198` (TABLE map) and `SERVICE_TESTS` (:258+, `memoryDenies` :254); seeders `packages/db/src/testing/two-tenants.ts` (`seedMemory*`); core domain doc `docs/engineering/core-domains.md:23,109-110` and `CORE_DOMAIN_DEPENDENCIES`; ADR dir last is `0045`.
- `packages/ui/src/patterns/types.ts:72` already lists `M5` (UI only). `packages/drafting/src/playbooks/*` and the web pages/picker are #902-#904 (siblings), not this issue.

### Root Cause
Greenfield: M5 layer, `precedent_passage`, M5 services, embeddings module, flag and ADR do not exist.

### Affected Files
- `packages/validators/src/memory.ts` (+ `memory.test.ts`): add M5 layer, scopes user/workspace, M5 keys (`M5.playbook`, `M5.precedent`, style-preference keys), `PrecedentProposalSchema`, passage kinds, dismissal reason codes.
- `packages/db/src/schema/memory.ts`, new `packages/db/src/schema/precedent.ts`, `schema/index.ts`; new migration `packages/db/migrations/<next>_precedent.sql` + `meta/` snapshot/journal (layer CHECKs add M5; shared CHECK M4/M5; `precedent_passage` with RLS, clerk REVOKE, owner/shared scope policy).
- `packages/core/src/memory/m5/{playbook,precedent-bank,proposals}.ts`, `memory/index.ts` exports; `packages/core/src/memory/embedding.ts` (audit refused providers; reuse for M5).
- `packages/ai/src/embeddings.ts`, `packages/ai/src/index.ts`, `packages/ai/src/__tests__/` (India-only/refuse+audit test, static no-fine-tuning test).
- `packages/flags/src/keys.ts` (+ flags test if it enumerates), `packages/db/src/seed/demo/index.ts` (enable for demo workspace).
- `docs/adr/0046-style-learning-without-training.md`, `docs/engineering/core-domains.md`, `CORE_DOMAIN_DEPENDENCIES`.
- Enumerating tests to update: `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/cross-tenant-registry.ts`, `packages/db/src/testing/two-tenants.ts`, `packages/core/src/__tests__/cross-tenant/services.test.ts`, `packages/core/src/__tests__/cross-tenant/memory.test.ts`, `packages/i18n/src/__tests__/catalog.test.ts` (only if a namespace changes; none expected), `apps/worker/src/__tests__/registry.test.ts` and `schedules.test.ts` (unchanged: existing `memory.purge`), `e2e/tests/shell/layouts.spec.ts` and `packages/db/src/__tests__/docket-schema.test.ts` (verify, expected unchanged).
- New: `packages/core/test/memory-m5.integration.test.ts` (dir does not exist; core tests live in `src/**/__tests__`, so place at `packages/core/src/memory/__tests__/memory-m5.test.ts` unless the vitest include admits `test/`).

### Sibling Sweep
- Every `MEMORY_LAYERS`/layer-list copy: `packages/validators/src/memory.ts:11`, `packages/db/src/schema/memory.ts:38`, migration CHECK literals (memory_item, memory_proposal), `packages/core/src/memory/scope.ts:41` (clerk layers; M5 must stay out), `memory_clerk_readable`, `packages/core/src/lifecycle/{export,deletion}` (memory export/erasure must include `precedent_passage`: `lifecycle/export/exporters.ts`, `lifecycle/deletion/erase.ts`, `lifecycle/__tests__/memory-erasure.test.ts`), `packages/core/src/memory/review.ts` (monthly review lists layers).
- Same defect class (silent write path): ensure only `confirmMemory` writes `memory_item` and only the M5 confirm path writes `precedent_passage`.

### History
M1-M7 engine #72 (migration `20261026074215_memory.sql`, ADR 0044); drafting service #768/#824; M5 explicitly deferred to #81 in `memory.ts:4`. Siblings #902 (apply/ranking/style profile), #903, #904 (web) depend on this.

### Recommendation
One lane, ordered: (1) validators; (2) schema + migration + registries; (3) ai embeddings + static tests; (4) core m5 services (proposals create `memory_proposal` only; confirm creates `memory_item` M5 + `precedent_passage` in one transaction; retire/delete sets item deleted so the existing purge removes embeddings; search = SQL-scoped pgvector, owner/shared predicate, clerk denied); (5) flag + demo seed; (6) ADR + docs; (7) integration test. Encrypt `precedent_passage.body` with `encryptField` (AAD workspace id) like `memory_item`, consistent with privileged-work-product handling.

### Related Issues
Parent #81; depends on #72, #768 (closed); siblings #902, #903, #904; real embedding credentials #112.
