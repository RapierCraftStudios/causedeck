### Approach
Register one eCourts district status source per state, seed uncleared registry rows, and add a per-host budget in the fetcher shared by every source on a host.

### Changes
- packages/core/src/case-watch/lookup.ts: `STATUS_SOURCES` gains `in.{tn,ka,mh,dl,up}.district:case_status`.
- packages/fetch/src/fetcher.ts: per-host sliding-window budget (`DEFAULT_HOST_REQUESTS_PER_MINUTE` = 30, `hostRequestsPerMinute` dep), checked before any slot is spent.
- packages/db/migrations/20261024090000_ecourts_district_status_sources.sql (+ journal, snapshot): five uncleared court source rows.
- packages/i18n messages (en/ta/kn, generated files, d.ts): labels. apps/web/lib/case-watch/source-key.ts: key union (added as an amendment).
- Tests: fetcher.test.ts, case-watch.test.ts, source-registry.test.ts.

### Acceptance Criteria Status
- R1 ✅ lookup.ts STATUS_SOURCES, migration SQL
- R2 ✅ fetcher.ts per-host budget
- R3 ✅ existing provenance storage (lookup.ts), asserted in case-watch.test.ts
- R4 ✅ case-watch.test.ts "refreshes a watched district matter"

### Verification
- fetch fetcher+static-checks tests: pass; the two new host tests fail without the fetcher change.
- core case-watch.test.ts, db source-registry.test.ts, web case-watch-actions.test.ts, i18n catalog.test.ts: pass.
- turbo typecheck scoped: pass. eslint on changed core/fetch files: clean.

### Notes
- A host-budget denial reuses `source_rate_limited` (types.ts is not a deliverable; poll.ts defers on that reason), instead of a new `host_rate_limited`.
- Rows stay uncleared; counsel must clear before any fetch. The default host budget is 30 requests per minute for every source host.
