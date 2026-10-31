### Approach
Continued the checkpointed branch: pure extractors in `packages/intelligence/src/corpus/enrich/`, three global facet tables plus enrichment columns on `judgment`, and a `system.corpus.enrich` job that replaces only the rows of the version it runs, in one transaction per judgment.

### Changes
- packages/db/src/schema/corpus.ts: `judgment_statute_ref`, `judgment_citation_ref`, `judgment_tag`; `court_level`, `outcome`, `outcome_anchor`, `enrich_version`, `enriched_redaction_version` on `judgment`.
- packages/db/migrations/20261031002026_corpus_enrich.sql, meta/_journal.json, meta/20261031002026_snapshot.json: generated migration (the number comes from the generator, not the contract's placeholder name), grants.
- packages/db/src/conventions.ts, index.test.ts: new tables registered as global.
- packages/db/src/schema/corpus.test.ts: the editorial column-name test is replaced by an official-or-open-licence assertion on corpus sources (D-053).
- packages/db/src/__tests__/corpus-enrich.test.ts: schema and migration test.
- packages/intelligence/src/corpus/enrich/*: statutes, code-map (IPC/BNS, CrPC/BNSS, IEA/BSA), citations, subjects (resolver port), outcome (anchored or `unknown`), index with `ENRICH_VERSION`; match.ts exports the section parser.
- packages/core/src/jobs/definitions/corpus-enrich.ts (+ test), jobs/registry.ts: the job.
- apps/worker/src/__tests__/registry.test.ts, schedules.test.ts: job registered.

### Acceptance Criteria Status
- R1–R5: ✅ packages/db/src/schema/corpus.ts
- R6–R10: ✅ packages/intelligence/src/corpus/enrich/
- R11: ✅ enrich/index.ts (`rulesetVersion`)
- R12: ✅ packages/core/src/jobs/definitions/corpus-enrich.ts, apps/worker registry/schedules tests
- R13: ✅ packages/db/src/schema/corpus.test.ts
- R14: ✅ corpus-enrich.test.ts (core): BNS 106 facet finds the IPC 304A judgment
- R15, R16: ✅ enrich-eval.test.ts (labelled set, reported)
- R17: ✅ core test: outcome `unknown` with null anchor
- R18: ✅ core test "replaces only the rows of the version it runs"

### Verification
- V1 intelligence: pass.
- V2 core: pass. The first run failed because the test tampered with a v1 row via UPDATE, which the app role may not do. The test now checks that v1 row ids survive a v2 run.
- V3 db: pass (36 tests).
- V4 worker: pass (11 tests).
- V5 checks.mjs: scoped typecheck passes. Lint on the changed files is clean after fixes. `lane-check.sh` does not exist on this host, so the scoped commands were run by hand.
- `forgedock check`: PASS.
- New tests were not run against a build without the fix, so fails_without_fix is unknown.

### Notes
No env vars. The job runs every 10 minutes (`5-59/10 * * * *`). The subject resolver is optional; without one, no tags are written.

### Stale-list follow-up
Checked the listed admin/web tests: none enumerate corpus schema exports (their lists are unrelated mocks), so the new symbols are recorded as `not_members` in result.json. No code change.
- Stale-list check: the new `@causedeck/db` exports (`JUDGMENT_OUTCOMES`, `judgmentCitationRef`, `judgmentStatuteRef`, `judgmentTag`) are not members of the lists in the 8 flagged admin and web tests. Those lists are mock data for other modules, so each is recorded in `result.json` `not_members` with a reason.
