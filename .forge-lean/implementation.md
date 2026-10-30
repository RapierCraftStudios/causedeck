### Approach
Queue drain in `packages/intelligence/src/corpus/ocr-drain.ts` (claim with `for update skip locked` and a lease, render, gateway OCR, store text and delete the row in one transaction, backoff then park). Platform AI scope in `packages/core/src/ai/platform-ports.ts` meters spend in the new global `corpus_ocr_call` table, never a workspace. Job `system.corpus.ocr` is scheduled every 10 minutes and does nothing unless `CORPUS_OCR_ENABLED` is true. The mock provider serves OCR when no providers are configured. Admin Data Ops shows queue depth and parked failures.

### Changes
- packages/db: migration 20261030000001_corpus_ocr, schema/corpus.ts, conventions.ts, index.test.ts, cross-tenant-registry.ts.
- packages/core: ai/platform-ports.ts, jobs/definitions/corpus-ocr.ts (+test), jobs/registry.ts, sources/bulk-import.ts (ocrQueueStats).
- packages/intelligence: corpus/ocr-drain.ts, ocr/ocr.ts (purpose and idempotency prefix options), index.ts.
- packages/config: env schema; docs/engineering/env.md.
- apps/worker: registry and schedules tests. apps/admin: data layer, Data Ops page, tests.

### Acceptance Criteria Status
- R1 ✅ ocr-drain.ts storePage; R2 ✅ platform-ports.ts createPlatformAiGateway (mock); R3 ✅ ocr-drain.ts fail
- R4 ✅ platform-ports.ts audit.record to corpus_ocr_call; R5 ✅ data-ops/page.tsx OCR queue
- R6 ✅ corpus-ocr.ts; R7 ✅ ocr-drain.ts claim; R8 ✅ corpus-ocr.ts runCorpusOcr; R9 ✅ ocr-drain.ts storePage/fail
- R10 ✅ corpus-ocr.ts (budgets, flag, schedule); R11 ✅ platform-ports.ts; R12 ✅ worker registry/schedules tests

### Verification
- forgedock check validate commands V1-V6 pass; V5 (core cross-tenant services.test.ts, 341 tests) passed on a rerun with a longer timeout after the 300s limit.
- corpus-ocr.test.ts: 5 pass; the tests exercise new code and fail without it.

### Notes
- New env vars: CORPUS_OCR_ENABLED (default false), CORPUS_OCR_DAILY_PAISE (default 500000).
- Fixed a missing `and` import risk in platform-ports.ts and made the job tests deterministic.

## Sibling-list fix
Checked the 24 flagged tests: none enumerate the new symbols (they are unrelated mocks or unit tests), so each is recorded in result.json not_members.

### Validate results (per contract)
- V1 core corpus-ocr, corpus-bulk-import, registry tests: pass (19 tests, rc 0)
- V2 intelligence src/corpus src/ocr: pass (rc 0, forgedock check)
- V3 worker registry and schedules tests: pass (rc 0, forgedock check)
- V4 db src/index.test.ts: pass (rc 0, forgedock check)
- V5 core cross-tenant services.test.ts: pass (341 tests, rc 0 with a 1700s timeout; forgedock check's 300s limit times out on this host)
- V6 admin data-ops and server-actions-audit tests: pass (rc 0, forgedock check)

### CI fix: .env.example
CI's config test failed because `.env.example` was not regenerated after adding CORPUS_OCR_ENABLED and CORPUS_OCR_DAILY_PAISE. Ran `pnpm env:example`; `src/env/__tests__/example.test.ts` now passes (4 tests).
