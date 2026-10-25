**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: P1 feature (greenfield backend service; blocks #61 Brief Sheet, #74 memory wiring, readiness rings in #59)
**Task Type**: feature

### What Was Claimed
Build brief assembly in `packages/core`: `assembleBrief(ctx, listingId)` composes a derived, provenance-carrying per-listing preparation brief (stage, last order in 2-3 lines, open obligations, carry list, M3 synopsis, last hearing, M4 court notes, up to 5 matter-scoped document passages), `computeReadiness`, lawyer-authored `brief_state` (prepared mark, carry edits, note), stale detection with a `brief.stale` event, and a `brief.refresh` job. Deterministic first; AI only compresses the last order from anchored extraction output (#46).

### What We Found
Verified at base `origin/milestone/prepare-execute` (HEAD 5f8640ec contains it; #58 and #46 are merged, so both dependencies are met).
- The `.forge-lean/investigation.md` and `contract.json` that were present in the worktree described #58 (court-day) and were overwritten; they are not about #60.
- Nothing exists for the brief: no `assembleBrief`, `computeReadiness`, `brief_state`, `brief.refresh`, `brief.stale`, no `packages/core/src/briefs/`, no `packages/validators/src/brief.ts` (grep over ts/sql/md).
- Listing/stage source: `listing` (`packages/db/src/schema/docket.ts:50`; `proceedingId`, `stageRaw`/`stageNorm`, provenance columns from `packages/db/src/columns.ts:76`). `hearing` `docket.ts:105`, `order` `docket.ts:180` (`operativeDirections: {text, anchorId}[]` `docket.ts:175-194`, `nextDate`, provenance), `obligation` `docket.ts:234` (`description`, `dueDate`, `ownerMemberId`, `status`, `sourceOrderId`), `task` `docket.ts:312`.
- Anchored extraction (#46): `extraction` table `packages/db/src/schema/extraction.ts:29` (`result` jsonb, `status` current|superseded, `deterministicOnly`, `aiCallId`); body `packages/core/src/extraction/run.ts` (not re-exported from the package root, `extraction/index.ts`); job `packages/core/src/jobs/definitions/extraction-extract-order.ts`. Anchors: `anchor` `packages/db/src/schema/documents.ts:187` (page_no, quote, char range); pages `documentPage` `documents.ts:140` with a `simple` full-text `searchTsv` + GIN index (`:158,:166`). There is NO document-embedding table, so context retrieval is matter-scoped full-text (the AC allows "pgvector or full-text").
- Memory (#72) is not built: no `memory_item`/`memory_embedding` table (only the erasure plumbing that tolerates missing tables, `packages/core/src/lifecycle/deletion/memory.ts:23`). Policy actions `memory.read`/`memory.write` (junior+) and `strategy.read` (junior+) already exist (`packages/auth/src/policy/matrix.ts:22-24`); a clerk (rank 1, `role-rank.ts:16`) is denied them, which gives the server-side omission. M2/M3/M4 must therefore come through an injected `MemoryProvider` port that defaults to empty (the issue says "until then an empty provider"); #74 wires the real one.
- AI: `createCoreAiGateway` (`packages/core/src/ai/index.ts`), `AiGateway` from `@causedeck/ai`, mock provider unless configured; `ai_call` rows are written by `packages/ai/src/gateway.ts`. Pattern for skipping AI: `extraction/run.ts` (sensitive matter `matter.sensitive` `packages/db/src/schema/matter-graph.ts:32`, no `ai_call` row when deterministic only).
- Court-day (#58) is merged: `packages/core/src/court-day/{query,scope,diff,...}.ts`; `CourtDayEvent` `court_day.list_changed` is emitted through an injected port (`court-day/scope.ts:30-45`) and "no job is registered"; the `brief.refresh` enqueue from that event is therefore a consumer to write, not an existing subscriber. Scope helper to mirror: `court-day/scope.ts` (`withWorkspace`, role from membership row, `can()`).
- Jobs: defined with `defineJob` in `packages/core/src/jobs/definitions/*.ts`, listed in `packages/core/src/jobs/registry.ts` (imports ~`:31-36`, list ~`:210`, type list ~`:269`); expected names in `apps/worker/src/__tests__/registry.test.ts:~150-175` and scheduled names in `apps/worker/src/__tests__/schedules.test.ts:~45`. `apps/worker/src/jobs/` does not exist (the issue's path `apps/worker/src/jobs/brief-refresh.ts` is wrong). The cross-workspace "all tomorrow's listings" sweep needs an owner-defined target function like `app_portfolio_alert_targets()` (`packages/core/src/jobs/definitions/portfolio-alert-scan.ts:48-52`, migration `20261024120000_portfolio_alert_targets.sql`), because tenant tables are under FORCE RLS.
- Conventions differ from the issue: migrations are `packages/db/migrations/<timestamp>_<name>.sql` with `meta/<ts>_snapshot.json` + `_journal.json` (latest `20261024170000_court_day.sql`), not `packages/db/drizzle/`; seeds are `packages/db/src/seed/` (`court-day-fixtures.ts` precedent), not `seeds/`; core tests are colocated; next ADR is 0038 (`docs/adr/0037-court-day-read-model.md` is last; update `docs/adr/README.md`).
- Registries that will fail CI if skipped: new table `brief_state` in `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `packages/db/src/testing/cross-tenant-registry.ts` (`DB_TABLES_TEST` / `SERVICE_TESTS` / `NOT_A_SERVICE`), `packages/db/src/testing/two-tenants.ts` seeder, `packages/db/src/schema/index.ts`; new core exports in `cross-tenant-registry.ts` + `packages/core/src/__tests__/cross-tenant/services.test.ts`; new domain in `packages/config/eslint/core-domains.js` (`'court-day'` precedent at `:23`) and `docs/engineering/core-domains.md`; new job in the two worker tests above.

### Root Cause
Greenfield. The inputs now exist (matter graph, listings, anchored orders, obligations, court-day events), but nothing composes them into a brief, persists lawyer brief state or detects staleness.

### Affected Files
- `packages/validators/src/brief.ts` (+ `index.ts` export, test)
- `packages/db/src/schema/brief.ts`, `schema/index.ts`, migration `packages/db/migrations/<ts>_brief_state.sql` (+ RLS, `app_brief_refresh_targets()`), `meta/` snapshot and journal
- `packages/core/src/briefs/{assemble,readiness,state,refresh,index}.ts`, `briefs/sections/{stage,last-order,obligations,carry,synopsis,last-hearing,court-notes,context}.ts`, colocated tests
- `packages/core/src/jobs/definitions/brief-refresh.ts`, `packages/core/src/jobs/registry.ts`
- `apps/worker/src/__tests__/registry.test.ts`, `schedules.test.ts`
- `packages/core/src/index.ts` (re-export), `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`
- `packages/db/src/{index.test.ts,__tests__/rls/sql.test.ts,testing/cross-tenant-registry.ts,testing/two-tenants.ts,seed/brief-fixtures.ts}`, `packages/core/src/__tests__/cross-tenant/services.test.ts`
- `docs/adr/0038-brief-as-derived-view.md`, `docs/adr/README.md`

### Sibling Sweep
- Same "derived view with provenance" class: `court-day/query.ts` (#58) and `matter-graph/read-models.ts`; reuse their provenance shape and scope helper rather than a new one.
- Same "no outward action" posture as `court-day` (no send/file); assert by an export-name test on the briefs barrel.
- `cross-tenant` and registry guard tests are the usual needs-human source (CLAUDE.md); every new export and table is covered in the deliverables.

### History
- `git log` shows #58 (court-day) merged last (5f8640ec, fixes 6a91720a, caff8780); #46 extraction merged earlier. No prior brief work. Prior #58 lane went needs-human on CI (`ci.red`, scope_creep): keep to the listed files and update registries in the same change.

### Recommendation
Implement in one lane in this order: validators -> schema/migration/registries -> sections + `assembleBrief` -> readiness -> state + stale -> refresh job + schedule -> ADR/docs. Inject `MemoryProvider`, `BriefEvents`, `now`, `gateway` through a `BriefDeps` (as court-day does); default memory provider is empty; no new policy action (use `listing.read`, `memory.read`, `strategy.read`, `matter.write`). Performance (p95) is asserted on the deterministic path against seeded fixtures with a CPU-time budget (see the #58 R13 precedent, f4421c80).

### Related Issues
#1 (parent), #58 (merged, dependency), #46 (merged, dependency), #61 (Brief Sheet UI, consumer), #59 (board readiness ring, consumer), #67 (obligations, enqueues refresh), #72 / #74 (memory engine and wiring: replace the empty provider).
