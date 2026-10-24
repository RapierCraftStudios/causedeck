**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (greenfield data store plus a legal-gated surface that ships dark; nothing user-visible changes while `bench_facts` is off)
**Task Type**: feature

### What Was Claimed
D-050: hold bench-level data in an internal staff-only store (bench, sitting date, hall, items listed/heard/disposed, minutes per item) that the app DB role cannot read; aggregate it from rosters, display boards and status in `packages/intelligence`; use it internally (call-time estimates, roster reconciliation, coverage #517, data ops #514); expose a neutral bench card behind flag `bench_facts` (off until counsel, #118); add static guards against ratings, rankings, comparisons, outcome rates, predictions and sentiment.
The issue's existing comments (FORGE:INVESTIGATION on api-keys, #624) belong to other issues and are ignored.

### What We Found
- Dependencies are all closed on this base: #479 (`packages/fetch`), #493 (display board), #593. #483 closed not_planned, but its status tables and parsers exist (`packages/db/src/schema/case-watch.ts`, `packages/adapters/src/status/`).
- No bench-facts store, flag or aggregation exists (`grep bench_facts` finds only DECISIONS.md D-050, docs/legal/court-data-posture.md, the PRD). Latest migration is `packages/db/migrations/0081_api_keys.sql`, so the next is 0082.
- Pace input today: `board_observation` (`packages/db/src/schema/display-board.ts:14-34`) is global; the app role has SELECT and INSERT (`migrations/0076_display_board.sql:22-23`). The estimate is `paceSamples`/`estimateCallWindow` (`packages/core/src/court-day/eta.ts:66-90`), fed from raw observations at `packages/core/src/court-day/board.ts:399-420`. It has no bench-level pace input.
- Roster data is tenant data: `bench_roster`/`bench_roster_entry` (`packages/db/src/schema/roster.ts:59,107`) are FORCE-RLS and lawyer-supplied. `bench` (`schema/court.ts:72-88`) is global-or-workspace and holds `judges` (the only judge column; pinned by `packages/db/src/__tests__/judge-aggregation-guard.test.ts:25-27`). Joining rosters across workspaces therefore needs an owner-defined function (precedent `app_board_poll_targets`, `0076_display_board.sql:45-46`, returns ids only).
- DB roles: only `causedeck_owner`, `causedeck_app`, `causedeck_clerk` exist (`packages/db/src/client.ts:10` `DbRole = 'app' | 'owner'`). The worker and web both connect as the app role, so "only the worker and internal roles have grants" cannot be met with a new role without infra and credentials. The existing precedent for hiding data from the app role is REVOKE on the table plus SECURITY DEFINER functions (`0072_staff_parse_yield.sql`, `0033_staff_console_reads.sql:21` `app_staff_require_caller`).
- Flags: `packages/flags/src/keys.ts:58-63` (e.g. `court.live-tracking`). Registry guards: `packages/flags/src/__tests__/keys.test.ts:15-60` (exact key list plus LEGAL list), `__tests__/docs.test.ts:16` (doc row regex `[a-z0-9.-]+` rejects `_`), the `FLAG_KILL_SWITCHES` env declaration in `@causedeck/config/env`, and `docs/engineering/flags.md`.
- No user-facing judge or bench-facts surface exists; `judges` appears in the web only in roster import review. API routes live in `apps/api/src/routes/v1/` (billing, me, workspaces) and are listed in `apps/api/src/__tests__/cross-tenant.test.ts:~71`.
- Global tables must be listed in `packages/db/src/conventions.ts:45-80` (GLOBAL_TABLES) and `packages/db/src/index.test.ts:~69`.

### Root Cause
Greenfield: facts live in separate stores (tenant rosters, global board observations, tenant status snapshots) with no joined, policy-enforced internal store or flagged surface, and the call-time estimate learns pace only from raw per-hall observations.

### Affected Files
- `packages/db/src/schema/bench-facts.ts` (new), `schema/index.ts`, `conventions.ts`, `index.test.ts`, migration `0082_bench_facts.sql` plus `meta/0082_snapshot.json` and `_journal.json`
- `packages/intelligence/src/bench-facts/` (new, pure aggregation plus persistence) and its export in `packages/intelligence/src/index.ts`
- `packages/core/src/court-day/` (pace read from bench facts in the estimate; flag-gated `getBenchCard`)
- `packages/flags/src/keys.ts`, `packages/config` env kill switch, `docs/engineering/flags.md`, flags tests
- `apps/api/src/routes/v1/` (bench-card route) plus `cross-tenant.test.ts`
- Registries: `packages/db/src/testing/cross-tenant-registry.ts`, `core/src/__tests__/cross-tenant/services.test.ts`, `docs/engineering/core-domains.md` if imports change
- Docs: an ADR (next number after `docs/adr/0035-data-ops-alerting.md`)

### Sibling Sweep
Same defect class (content that must not leak to the app role or users): `board_observation`, `fetch_log` and `source_parse_run` are global tables with app-role grants and hold no judge data, so they are fine. `bench.judges` is the only judge column and the existing no-judge-aggregation guard must keep passing; the new table is keyed by `bench_id`, not judge. No other route returns bench or judge data.

### History
Pace and call-time estimate from #493 (`eta.ts`). The judge-aggregation prohibition from #349 (PX-9, ME-6) was narrowed by D-050 (DECISIONS.md:418-426), which allows internal bench-level data and still forbids ratings, rankings, outcome rates, predictions, profiling and sentiment. No prior bench-facts attempt.

### Recommendation
1. New global table `bench_sitting_fact` (bench_id nullable FK, source_id, hall_no, sitting_date, items_listed, items_heard, items_disposed, minutes_per_item numeric; unique per source, hall and date). No judge, outcome or rating column. REVOKE ALL from PUBLIC, app and clerk. Writes and reads go only through owner-defined functions granted to the app role: `app_bench_fact_record(...)`, `app_bench_pace(source_id, hall_no, since)` (internal, used by the worker and core), and a bench-card read that returns only neutral counts. A grants test proves direct SELECT as the app role fails with 42501. Record the "no worker or internal role exists" deviation in the ADR.
2. Pure aggregation in `intelligence/bench-facts` (board observations to per-hall, per-day pace and counts; bench resolved through an owner-defined ids-only roster lookup).
3. Core: the call-time estimate prefers bench-fact pace when available (fall back to raw observations). `getBenchCard` checks flag `bench_facts` first and returns null (route 404) when off; neutral wording only. Add API route.
4. Flag `bench_facts` (legal-gated, owner [521, 118]); key kept literally, so relax the docs test regex to allow `_`.
5. Static guard test over schema columns, the new source dirs and flag/route strings for rating, ranking, comparison, outcome-rate, prediction and sentiment terms.
6. Defer roster reconciliation, coverage (#517 is open and has no code) and the data ops console wiring, plus the web bench card UI (legal-gated, no consumer until counsel).

### Related Issues
#479, #483, #493, #593 (dependencies, closed), #118 (counsel, open), #517 (coverage, open), #514 (data ops console), D-050, D-049, D-027.
