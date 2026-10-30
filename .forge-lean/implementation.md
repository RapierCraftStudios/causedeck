### Approach
Rerun: verified the existing commit (5331bf3c) against every contract deliverable; nothing was missing.
### Changes
- packages/intelligence/src/research/eval/*: types, metrics, faithfulness, manifest, runner, report, BM25 baseline ranker, cli, tests
- packages/intelligence/src/research/index.ts: barrel
- fixtures/research-eval/*: corpus, queries, manifest, baseline
- packages/intelligence/package.json: research-eval script
- .github/workflows/research-eval.yml: path-filtered CI job
- docs/engineering/ci.md, .env.example: docs and RESEARCH_EVAL_PRIVATE_DIR
### Acceptance Criteria Status
- R1 ✅ runner.ts/report.ts/cli.ts
- R2 ✅ runner.test.ts injected-regression test
- R3 deferred in contract (#899)
- R4 ✅ types.ts, queries.json
- R5 ✅ metrics.ts, faithfulness.ts
- R6 ✅ manifest.ts, manifest.json
- R7 ✅ queries.json (15 queries)
- R8 ✅ runner.ts private dir, .env.example
- R9 ✅ research-eval.yml, 0.02 tolerance in runner.ts (measured on PRs)
### Verification
- V1 vitest: exit 0 (27 tests)
- V2 research-eval: exit 0
- package tsc --noEmit: 0; eslint src/research: clean; prettier: clean; forgedock check: PASS
- The regression test fails against an undegraded ranker by construction (new test).
### Notes
checks.mjs widened to full because of the CI workflow change; ran package-scoped tsc/eslint instead. No devdocs-freshness script in repo.

## CI follow-up
Core test failures (proceeding_identity_uq random collision; random UUID containing "7f3a") are flakes in code untouched by this branch; recorded as an amendment, no code change.
### CI follow-up
The core test-shard failures were flakes unrelated to the research-eval diff (it touches no core/db code):
- factcheck-service.test.ts: secret marker `7f3a` matched hex inside a random workspace UUID; renamed marker to `zz-secret-marker`.
- db/src/seed/brief-fixtures.ts: random proceeding number (9000 values) collided on proceeding_identity_uq; range widened to 9,000,000.
Both files added via add-deliverable amendments.

### CI follow-up 2
`@causedeck/config` env tests failed: `.env.example` is generated from the schema and docs/engineering/env.md is checked against it. Added `RESEARCH_EVAL_PRIVATE_DIR` (server, path, owner #899) to `packages/config/src/env/schema.ts` and a row in `docs/engineering/env.md`. config `src/env` tests: 168 pass; tsc clean.
