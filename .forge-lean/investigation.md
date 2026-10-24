**Verdict**: CONFIRMED
**Confidence**: medium
**Severity**: medium (P1 label; greenfield and additive: new tables, a staff queue and one web action; no existing writer changes)
**Task Type**: feature

### What Was Claimed
Reliable data needs a human-in-the-loop queue for low-confidence parses, cross-source conflicts (#499) and user-reported errors. Conflicts only reach the lawyer's own workspace, and there is no report-an-error path. Wanted: (1) a "report an error" action on a fetched fact in `apps/web`, with consent to share the record with staff; (2) an `apps/admin` Review queue (low parse confidence, conflicts, reports) with assignment, SLA, a fix form and send-to-workbench for a regression fixture; (3) fixes to global records propagate to watchers as corrections with provenance "corrected by CauseDeck review". Acceptance: report reaches the queue and its fix reaches every watcher (integration); a fixed item becomes a fixture in one action (integration); reviewers see only the record under review and access is logged (unit).

### What We Found
- Base (`e89a069f`, lane `milestone/court-data-network`) has no review queue: no `review_*` table in `packages/db/src/schema/`, no `apps/admin/app/(console)/review`. Dependency #499 is merged: `packages/core/src/facts/agreement.ts` (`assessAgreement`), `packages/db/migrations/0082_staff_conflict_rate.sql` (`app_staff_conflict_rate`).
- Data Ops already has global, content-free tables and detectors: `packages/db/src/schema/data-ops.ts:39-123` (`source_health`, `source_parse_run` with `conflicts`, `data_ops_alert` incl. `parse_yield` and `conflict_rate` types at :23-30), `packages/core/src/data-ops/index.ts:20-33` (`recordParseRun`), `detectors.ts`. These are the natural producers of low-confidence and conflict queue items (source-level, no content).
- Conflicts are workspace-local: `proposeNextDate`/`chooseNextDateSource` in `packages/core/src/matter-graph/next-date.ts:1-17`; `listing` is a tenant table under FORCE RLS, staff reach tenant data only via SECURITY DEFINER functions guarded by `app_staff_require_caller()` (`packages/db/migrations/0033_staff_console_reads.sql:21`, pattern in `0072_staff_parse_yield.sql`, `0082_staff_conflict_rate.sql:11-35`) or a consented support session (`packages/core/src/support/access.ts:1-30`).
- Fetched facts a user could report: `case_status_snapshot.fields` (next date, stage, bench) keyed to `case_watch` (source_id + cnr) in `packages/db/src/schema/case-watch.ts:31-110`; `listing` provenance via `provenance()` at `packages/db/src/columns.ts:75-85`. Watchers of the same record = `case_watch` rows with same `source_id` and `cnr` across workspaces.
- Allowed `source_type` values (`columns.ts:14-22`) and `confirmation_state` (`columns.ts:30`: includes `corrected`) have no "CauseDeck review" value; provenance text can be carried in `source_ref` (e.g. `causedeck-review:<id>`) with `source_type='system'`.
- Staff console: capability matrix `apps/admin/lib/roles.ts:11-30` (`data-ops` capability is ops+admin), `requireStaff` at `apps/admin/lib/staff.ts:36`; staff reads are audited with `record(...)` and event `staff.read` (`packages/core/src/audit/events.ts:88`, used in `apps/admin/app/(console)/fixtures/actions.ts:1-20`). Fixture creation exists: `buildFixture`, `previewDocument`, `correctionsFromEdits` in `packages/adapters/src/workbench/` and `fixtures/actions.ts:119,148` (document lives only in the request, never stored).
- Registries that will fail CI if skipped: `packages/config/eslint/core-domains.js:93` (`'data-ops': []` today; a review domain needing `audit` must be declared) + `docs/engineering/core-domains.md`; `packages/db/src/testing/cross-tenant-registry.ts` (new runtime exports of `@causedeck/core`, new global/tenant tables), `packages/db/src/index.test.ts`, `packages/db/src/__tests__/rls/sql.test.ts`, `apps/web/__tests__/cross-tenant-actions.test.ts` (new `'use server'` action), `apps/admin/__tests__/server-actions-audit.test.ts` and `no-content-fields.test.ts` (admin actions must audit; no content fields).
- Stale `.forge-lean/*` and the investigation comment on the issue describe #499, not #518; ignored.

### Root Cause
Greenfield. Provenance and conflict detection exist, but conflicts and parse quality live in tenant workspaces or content-free global counters; there is no consented path to move one record to staff, no staff work queue (assignment, SLA, status), and no cross-workspace correction write-back.

### Affected Files
- `packages/db/src/schema/review.ts` (new), `packages/db/src/schema/index.ts`, migration `packages/db/migrations/<next free>_review_queue.sql` + snapshot/journal: global `review_item` (kind low_confidence|conflict|user_report, source_id, cnr/record key, field, shown/corrected value, consent flag, status, assignee, due_at, fixture_exported_at, no workspace id); tenant `review_correction` (workspace_id, proceeding_id, field, value, provenance, review_item_id); SECURITY DEFINER `app_review_propagate(item_id)` fanning a fix to every `case_watch` of the same source+cnr.
- `packages/core/src/review/{index,queue,propagate}.ts` (new) + `packages/core/package.json` export; `packages/config/eslint/core-domains.js`, `docs/engineering/core-domains.md`.
- `packages/core/src/data-ops/` evaluator hook to enqueue low-confidence / conflict items (content-free, dedup per source+kind).
- `apps/web`: report-error action + button on the fetched fact (consent checkbox), `apps/web/lib/matters/workspace.ts` read of `review_correction` shown as "corrected by CauseDeck review"; i18n `packages/i18n/src/messages/{en,kn,ta}/matters.json`.
- `apps/admin/app/(console)/review/{page.tsx,[id]/page.tsx,actions.ts}`, `apps/admin/lib/roles.ts` (add `review` capability to ops+admin, nav in `components/console-nav.tsx`).
- Registries and tests listed above.

### Sibling Sweep
- Same defect class (staff cannot see or fix tenant-held facts) exists for hearings, orders and notices (`packages/db/src/schema/docket.ts`, `notices.ts`, `cause-list-watch.ts` global publications). Scope the first cut to case-status fields (next date, stage, bench) with a field enum that can grow; note the others in a follow-up rather than silently dropping.
- `data_ops_alert` `conflict_rate`/`parse_yield` alerts are the only existing automatic signals; they are source-level, so queue items from them carry no record content.

### History
Conflict card #390; cross-source agreement and `app_staff_conflict_rate` #499 (0082); Data Ops #514/#515; fixture workbench #516; case-watch #589/#591/#592. No prior attempt at #518 (state `committed: []`).

### Recommendation
One lane, ordered: (1) schema + migration + registries; (2) core `review` domain (enqueue, assign, SLA, fix, propagate, audit) with unit tests; (3) admin Review queue pages and actions (audited `staff.read`, a reviewer sees one item's record only); (4) web report action with consent; (5) send-to-workbench action reusing `buildFixture`. Propagation writes tenant `review_correction` rows through the definer function (no direct `listing` writes: the `no-direct-listing-update` guard in `packages/core/src/__tests__/` stays green). Medium confidence because "global record" is not a table in this repo: it is modelled as source+CNR+field, and the one-action fixture needs the consented document stored on the item (retention limited to the item's life).

### Related Issues
#499 (dependency, merged), #514, #515, #516 (workbench), #478, #589/#591/#592, #390.
