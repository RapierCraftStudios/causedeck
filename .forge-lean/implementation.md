forge-stamp: issue=1197 contract=258ee944e529

### Approach
Redact and segment drain a backlog by queuing their own successor through the pg-boss producer, using each definition's singleton key (stately policy, concurrency 1), so there are never two runs at a time. The bulk import starts the drain after each committed batch through a new optional `afterBatch` hook in `runBulkImport`. Redact queues segment once it has no stale rows left. The segment cron (`*/10`) stays as the safety net.

This was a rerun and a CI recovery pass. The implementation in commit 4ee38585 already met the contract, so no new code was needed. The red checks on PR #1202 come from the base:
- **e2e (1/2):** 7 failures in copilot, drafting citations/authority-insert, the audit-feed and inbox visuals, and the Indic `ta` visual. The base PR #1199 (e7006481, the parent of this branch) fails e2e (1/2) on the same specs (run 45572326221), and so do the sibling PRs #1201 and #1203. Nothing under `e2e/` or `apps/web` references the corpus redact, segment or bulk-import jobs.
- **semgrep:** one finding (`raw-sql-bypasses-with-workspace`) in `packages/intelligence/src/research/retrieve.ts:127`, which #1199 added. This branch does not touch it, and it is not a deliverable. #1199, #1201, #1203 and #1204 fail semgrep the same way.

### Changes
- packages/core/src/jobs/definitions/corpus-segment.ts: the `CorpusDrainJob` type, `enqueueCorpusDrain` (producer.send with the singleton key) and `queueCorpusDrain` (a queue failure is a warn, never a failed run); a `deps.enqueue` seam; self-enqueue while `remaining`; doc comment fixed.
- packages/core/src/jobs/definitions/corpus-redact.ts: a `deps.enqueue` seam; queues redact while `remaining`, otherwise segment.
- packages/intelligence/src/corpus/bulk/import.ts: an optional `afterBatch({ inserted })`, awaited after the cursor commit when the batch inserted at least one row.
- packages/core/src/jobs/definitions/corpus-bulk-import.ts: passes an `afterBatch` that queues `system.corpus.redact`, warning on failure with ids and counts only.
- Tests: corpus-segment.test.ts (self-enqueue, plus a 250-judgment drain through redact and segment with no schedule tick), corpus-redact.test.ts, corpus-bulk-import.test.ts and import.test.ts (afterBatch calls and that an import with no `afterBatch` behaves as before).

### Acceptance Criteria Status
- R0 ✅ packages/core/src/jobs/definitions/corpus-segment.ts:161-163, drain test corpus-segment.test.ts:202
- R1 ✅ packages/core/src/jobs/definitions/corpus-segment.ts:163, packages/core/src/jobs/definitions/corpus-redact.ts:91-97
- R2 ✅ packages/intelligence/src/corpus/bulk/import.ts:262, packages/core/src/jobs/definitions/corpus-bulk-import.ts:131-132
- R3 ✅ packages/core/src/jobs/definitions/corpus-segment.test.ts:202 (fake clock: an import drains with no cron tick)
- R4 ✅ the batch sizes (100/200) and the one-transaction-per-judgment segment are unchanged; one batch per run (corpus-segment.ts:161)

### Verification
- V1 core corpus-segment/redact/bulk-import tests: PASS
- V2 intelligence import.test.ts + import.memory.test.ts: PASS
- V3 worker registry + schedules tests: PASS
- G2 core corpus-enrich + corpus-embed tests: PASS
- `forgedock check`: PASS
- Repro `-t 're-enqueues itself'` with the base corpus-segment.ts: FAILS (`expected [] to deeply equal [['system.corpus.segment']]`), so the test fails without the fix.

### Notes
- No new env vars. Schedules, job names, singleton keys, batch caps and payload schemas are unchanged.
- Behaviour change: redact now queues segment (or itself) at the end of every run, and a bulk import queues redact after every batch that inserted rows.
- Not pushed (the lane instructions say not to touch GitHub). The e2e and semgrep reds come from the base #1199 and need a separate fix there (the retrieve.ts raw SQL, and the copilot/visual e2e specs).

### CI follow-up: e2e (1/2), Playwright shard 1/2 (run 45595405501)
Not caused by this diff, so no code change and no amendment. The diff touches only corpus job definitions and the bulk importer (packages/core, packages/intelligence); no e2e spec, apps/web file or visual baseline is in it, and nothing in apps/web enqueues or reads these jobs. The same shard fails on base #1199 (run 45572326221) and on sibling PRs. The fix belongs to the copilot/visual e2e specs on #1199.
