### Approach
Rules-first redaction pipeline in `@causedeck/intelligence` (versioned, per-judgment in-memory placeholder allocator, optional injected zod-validated gateway hook for low-confidence spans). Derived columns on `judgment` hold the output; raw `page_text` and `sha256` are never written. Shared PII patterns moved to `pii-patterns.ts`. Core gets `applyMaskRequest` (audited) and the `system.corpus.redact` job (no fetch).

### Changes
- packages/adapters/src/workbench/pii-patterns.ts (+ test), detect.ts: shared patterns, plus bank account, vehicle number and address cues
- packages/intelligence/src/corpus/redact/*: pipeline, roles, names, sensitive categories, gateway hook, 40 synthetic fixtures, eval, EVALUATION.md, tests; corpus/index.ts exports it; ingest.ts redacts before insert
- packages/db: judgment columns, `corpus_mask_request`, migration 20261030201232_corpus_redaction (renumbered after the base's corpus_ocr; snapshot regenerated with drizzle-kit, SQL unchanged), conventions, tests, cross-tenant registry
- packages/core: corpus/masking.ts, audit event `corpus.mask_applied`, corpus-redact job and registry, research/alerts.ts reads `redacted_text`, static page-text access test, domain deps and docs
- apps/worker registry test: `system.corpus.redact`

### Acceptance Criteria Status
R1 ✅ redact/redact.ts; R2 ✅ pii-patterns.ts; R3 ✅ redact/roles.ts, gateway.ts; R4 ✅ redact/redact.ts; R5 ✅ redact/names.ts; R6 ✅ redact/sensitive.ts; R7 ✅ redact/version.ts, ingest.ts; R8 ✅ db/schema/corpus.ts; R9 ✅ db/schema/corpus.ts, db/src/index.test.ts; R10 ✅ core/corpus/masking.ts (registry: NOT_A_SERVICE, global tables); R11 ✅ __tests__/page-text-access.test.ts, research/alerts.ts; R12 ◐ post-deploy amendment (40 synthetic judgments, recall 100%, over-redaction 0%; EVALUATION.md:6); R13 ✅ redact/redact.test.ts; R14 ✅ redact/eval.test.ts; R15 ✅ jobs/definitions/corpus-redact.ts + test; R16 ✅ corpus/masking.ts + masking.test.ts; R17 ✅ page-text-access.test.ts

### Verification
After the merge: V1, V2, V3, V4, V5 and V7 pass (V7: 2 files, 11 tests). V6 (cross-tenant services, 341 tests) passed before the merge; the merge only added a NOT_A_SERVICE key beside the base's. forgedock check caps each command at 300s, which V5-V7 exceed on this loaded host; they pass when run directly. Typecheck: turbo (with node_modules/.bin on PATH) passes except web, which needs a 6 GB heap and then exits 0. New tests fail without the fix: the modules and columns do not exist.

### Notes
No env vars. Migration is additive. R12's labelled set is synthetic (K4); re-run the eval on #119 or imported judgments post-deploy. Ten admin and web tests were checked and do not list schema exports, so they are recorded in result.json not_members. scripts/check-devdocs-freshness.sh does not exist in this repo.
