### Approach
eCourts establishment snapshot (JSON) is validated, mapped to A0 `ForumSeed`s and spread into `FORUM_CATALOGUE`; the shipped snapshot is empty (real data is #640). Nothing is fetched.
### Changes
- packages/db/src/seed/forum-catalogue/ecourts/snapshot.ts: types, `validateSnapshot`, `snapshotToForumSeeds` (A0, per-state level flag)
- ecourts/snapshot.json: empty reviewed snapshot with provenance
- ecourts/index.ts: `ECOURTS_DISTRICT`
- forum-catalogue/index.ts: spread, version 2026-10-24.1, chunked upsert (2000 rows)
- ecourts/snapshot.test.ts, ecourts/import.test.ts: unit and DB integration tests (import test fixed to use drizzle `TransactionRollbackError`)
- packages/db/src/seed/README.md: documented
### Acceptance Criteria Status
- R1 ✅ snapshot.ts validateSnapshot
- R2 ✅ forum-catalogue/index.ts:23
- R3 ✅ snapshot.ts per-state level map
- R4 ✅ snapshot.json, no fetching
- R5 ✅ ecourts/import.test.ts
- R6 ✅ ecourts/snapshot.test.ts
- R7 ✅ version bump + determinism tests
### Verification
- V1 db vitest src/seed/forum-catalogue: pass (24 tests); import test failed before the rollback fix
- V2 core vitest forums.test.ts: pass
- V3 db tsc --noEmit: pass
### Notes
In this sandbox Testcontainers' Ryuk log wait fails; validate commands pass with `TESTCONTAINERS_RYUK_DISABLED=true`. No behaviour change to shipped catalogue content except the version bump.
