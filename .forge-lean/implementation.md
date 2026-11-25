forge-stamp: issue=1171 contract=fbd52c1f8515

### Approach
This is a rerun. The earlier run's work already met the contract, and V1–V5 passed. That PR (#1181) went red only on `e2e (1/2)`, in the Playwright step, and failed again on two reruns. Since the branch point, staging has gained the copilot panel redesign (#1183, which also rewrote `e2e/tests/matters/copilot.spec.ts`) and the copilot lexical search fix (#1199, 68 s to 5 s). Nothing in this diff touches the e2e paths: the admin pages under test, the judgment insert columns and the e2e DB template all still work with the additive migration. So the branch now merges `origin/staging` and is re-verified on top of it. The migration is also renumbered to the number reserved for this lane.

### Changes
- Merge of `origin/staging` (clean, no conflicts; staging has no `packages/db` changes).
- packages/db/migrations/20261031181222_corpus_hf_import.sql (was 20261031181220): renamed to the reserved number. The SQL is the same apart from the header line, which names the new number.
- packages/db/migrations/meta/20261031181222_snapshot.json (was 20261031181220): renamed, content the same.
- packages/db/migrations/meta/_journal.json: the tag now uses the new number.
- packages/intelligence/src/corpus/hf/import.ts: the comment that names the migration number is updated.
- The earlier commits (unchanged): schema (corpus.ts), conventions, index.test, the hf reader/map/quality/import/index, the corpus barrel, the core job and its registry entry, the worker registry test, and the admin Data Ops action and form.

### Acceptance Criteria Status
- R1 ✅ packages/intelligence/src/corpus/hf/reader.ts:22 (pinned hosts), :159 (rowStart/rowEnd range reads); map.ts:27 (filters)
- R2 ✅ packages/intelligence/src/corpus/hf/import.ts:102-139 (corpus_import_cursor per file)
- R3 ✅ packages/intelligence/src/corpus/hf/import.ts:216-220 (redactJudgment with extraNames)
- R4 ✅ packages/intelligence/src/corpus/hf/quality.ts:20,39; import.ts:145,172 (text_hash dedupe, CNR alias)
- R5 ✅ packages/intelligence/src/corpus/hf/import.ts:263-268; packages/db/src/schema/corpus.ts:123-136
- R6 ✅ packages/intelligence/src/corpus/hf/import.ts:254 (redacted_text written; segmented_redaction_version stays 0, so the existing corpus.segment enrichment picks the row up)
- R7 ✅ packages/db/migrations/20261031181222_corpus_hf_import.sql:27-30 (source row)
- R8 ✅ packages/core/src/jobs/definitions/corpus-hf-import.ts:81-88,113
- R9 ✅ apps/admin/app/(console)/data-ops/actions.ts:103; page.tsx:175
- R10 ✅ packages/intelligence/src/corpus/hf/import.test.ts:267
- R11 ✅ packages/intelligence/src/corpus/hf/import.test.ts:167
- R12 ✅ packages/intelligence/src/corpus/hf/import.test.ts:221,245
- R13 ✅ packages/core/src/jobs/definitions/corpus-hf-import.test.ts:67
- R14 ✅ items 1-4 and 6 delivered through R1-R13

### Verification
- V1 intelligence hf/bulk/ingest: exit 0 (42 passed)
- V2 core job tests: exit 0 (14 passed)
- V3 worker registry/schedules: exit 0 (11 passed)
- V4 admin data-ops/audit: exit 0 (56 passed)
- V5 db index.test: exit 0 (4 passed)
- G1 db src/testing: PASS (forgedock check)
- Typecheck: db, intelligence and core pass one by one (`pnpm --filter … typecheck`). The scoped turbo typecheck went over the host limit, so lane-check left it to CI.
- Migration lint: 149 files OK. ESLint and Prettier ran on the edited file and in the pre-commit hook: clean.
- The regression tests (import.test.ts resume/dedupe/garble/redaction, corpus-hf-import.test.ts refusal) fail without the fix: the hf module and the job do not exist on the base.
- e2e was not run locally (host rule); it runs in CI on the merged tree.

### Visual Check
not rendered: no local browser is allowed on this host. The Data Ops form reuses the neighbouring bulk-import form's markup and classes (page.tsx:169-202).

### Notes
- No new env vars. The source `hf-overthelex` is registered uncleared, so the job is skipped until staff clear it.
- Existing judgments get `pinpoint_state = 'verified'` by default; nothing existing changes.

### CI stale-list follow-up
The ten flagged tests (admin growth-page, headers, server-actions-audit, sources-actions; web activity-export-route, billing-actions, case-watch-actions, conflicts-action, cross-tenant-actions, document-preview-sheet) name none of the sibling schema exports (judgment, judgmentSegment, JUDGMENT_OUTCOMES, ...), so JUDGMENT_PINPOINT_STATES and judgmentCnrAlias are not members of any list there. Recorded in result.json not_members; no test edits.
