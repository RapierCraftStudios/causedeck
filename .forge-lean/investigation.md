**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: low (P3 greenfield, ships additive; no behaviour change to existing writers)
**Task Type**: feature

### What Was Claimed
Facts (next date, stage, bench) can come from a fetched page, a shared document and a voice-note outcome. Add `packages/core/src/facts/agreement.ts` (per fact: source set, agree|conflict|single status, confidence), generalise the date conflict card to every source pair (resolution kept), show a confidence chip with sources on hover in `apps/web`, and report a per-source conflict rate into adapter health. Acceptance: two disagreeing sources give one conflict card and agreeing sources raise confidence (unit); adapter health reports conflict rate per source (integration).

### What We Found
- No `packages/core/src/facts/` exists (verified on base `42236bb6`). Deps #478 (source registry, `packages/core/src/sources/registry.ts`) and #483's schema parts (#589/#591: `packages/db/src/schema/case-watch.ts`, `packages/core/src/case-watch/`) are merged, so not blocked. #483 itself is closed not_planned, but the pieces needed are on base.
- Every fact table carries provenance (`sourceType`, `sourceRef`, `anchorId`, `confidence`, `confirmationState`) via `provenance()` at `packages/db/src/columns.ts:75-85`; `listing` uses it at `packages/db/src/schema/docket.ts:70`.
- Today's conflict model is next-date only and two-sided: `proposeNextDate` returns a `NextDateConflict` {current, proposed} and stores the proposal as non-canonical `proposed` (`packages/core/src/matter-graph/next-date.ts:5-9,53-58`); `chooseNextDateSource` resolves it and marks the loser `corrected` (kept as history) (`next-date.ts:13-17`).
- UI: `apps/web/components/matters/date-conflict-card.tsx:1-60` (A/B columns, `ConflictView` at `apps/web/lib/matters/workspace.ts:79-83`, wired at `apps/web/app/(app)/w/[slug]/matters/[id]/page.tsx:35,75,131`); provenance chip `packages/ui/src/patterns/provenance-chip/provenance-chip.tsx`; `useProvenance` in `next-date-card.tsx`.
- Adapter health today: `getAdapterHealthSummary` reads the tenant-free view over `adapter_parse_run` (`packages/core/src/court/adapter-health.ts:20-26`, `packages/db/src/schema/adapters.ts:116-125`); staff per-source health is `sourceOpsOverview` / `staffParseYield` (`packages/core/src/sources/ops.ts:118-148`) using a staff definer function (`packages/db/migrations/0072_staff_parse_yield.sql`), shown at `apps/admin/app/(console)/data-ops/page.tsx`. Neither carries conflict counts.
- Registries to update: `CORE_DOMAIN_DEPENDENCIES` (`packages/config/eslint/core-domains.js:28-36`) + `docs/engineering/core-domains.md`; cross-tenant `SERVICE_TESTS`/`NOT_A_SERVICE` (`packages/db/src/testing/cross-tenant-registry.ts`) and `packages/core/src/__tests__/cross-tenant/services.test.ts`; `apps/web/__tests__/cross-tenant-actions.test.ts` if a new action is added.
- `.forge-lean/*` and an earlier issue comment on #499 describe #500 (conflict-of-interest); they are not about this issue and were ignored/overwritten.

### Root Cause
Greenfield: provenance is stored per row but nothing compares rows across sources, and `ConflictView` only models current-vs-proposed next date.

### Affected Files
- new `packages/core/src/facts/{index,agreement}.ts` (pure `assessAgreement` over observations; `getNextDateAgreement` reader over a proceeding's listings), `packages/core/package.json` export map, `packages/core/src/index.ts` if domains are barrelled
- `packages/core/src/matter-graph/` read model only if the overview must surface agreement (additive)
- `apps/web/components/matters/` (confidence chip with sources on hover, conflict card generalised to N sources), `apps/web/lib/matters/workspace.ts`, i18n `packages/i18n/src/messages/{en,kn,ta}/matters.json` (+generated)
- staff conflict-rate: new migration (next free number; 0082 after the base took 0080 and 0081) with a security-definer `app_staff_conflict_rate(since)` mirroring 0072, `packages/core/src/sources/ops.ts` (+ `SourceOpsRow` field), `apps/admin/app/(console)/data-ops/page.tsx`; `packages/db/src/__tests__/staff-console-schema.test.ts`
- registries listed above

### Sibling Sweep
Same pattern (cross-source facts with provenance) exists for `hearing`, `order`, `obligation`, `task` in `packages/db/src/schema/docket.ts` and case-status snapshots (`case_status_snapshot.fields`: next date, stage, bench). Plan covers next date and stage/bench from snapshots; hearings/orders out of scope. `automation/handlers/next-date.ts` and `case-status-change.ts` are the existing propose paths and must keep working.

### History
Conflict card introduced by #390 (see header of `next-date.ts`/`date-conflict-card.tsx`); source registry #478; case-watch #589/#591. No prior attempt at #499.

### Recommendation
Implement a pure agreement model first (fully unit-testable), a thin DB reader, then UI chip, then the staff conflict-rate path. Keep `chooseNextDateSource` semantics (a person chooses; loser stays `corrected`) as the "resolution is kept" mechanism; do not auto-resolve. Confidence rule: base from per-source confidence, boosted per additional agreeing independent source, capped at 1; conflict caps it low. Medium confidence because per-source attribution of a listing (`source_ref` URL host vs `source.base_url`) needs checking during implementation.

### Related Issues
#478 (source registry), #483/#589/#591 (case-watch), #390 (conflict card), #514 (Data Ops), #500 (unrelated, conflict of interest).
