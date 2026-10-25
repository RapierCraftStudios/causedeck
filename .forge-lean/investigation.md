**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: high (no backups or DR exist for client data; PRD §8 RPO/RTO unmet)
**Task Type**: feature

### What Was Claimed
Issue #101 asks for Stage A backup and DR: continuous WAL archiving and nightly base backups with WAL-G to India object storage (14 daily + 8 weekly, 14 days PITR), client-side encryption with off-host key custody, nightly MinIO replication to a second India location (versioning, delete protection), an automated restore drill (isolated container, amcheck, row-count manifest, RLS and cross-tenant checks, JSON report with RPO/RTO), a guarded PITR restore script, a `ops.backup.health` job with four metrics, a weekly drill workflow, runbooks, crypto-erase documentation and tests. 12 acceptance criteria.

### What We Found
- #97 is merged on the base: the Postgres image already bundles WAL-G (`infra/docker/postgres/Dockerfile:7-28`) and `postgresql.conf:19-25` already sets `archive_mode = on`, `archive_timeout = 60`, `archive_command = 'wal-g wal-push %p'`. Missing: encryption env, base backup, retention, restore, replication, metrics.
- `infra/docker/compose.prod.yml:244-247` passes only `WALG_S3_PREFIX` and `AWS_ENDPOINT` to postgres; `minio-init` (`:305-323`) creates only `causedeck-wal`; no versioning, no replication, no backup runner. `env/prod.env.example:36-38` has the WAL-G target only; no `infra/docker/postgres/wal-g.env.example`.
- No `infra/scripts/backup/`, `infra/scripts/restore/`, `infra/runbooks/restore.md`, `dr-hyderabad.md`, `drills/` or `.github/workflows/restore-drill.yml` exist (`git ls-tree HEAD`). Runbooks present: `infra/runbooks/workspace-deletion.md:65-69` (already promises backups hold no recoverable DEK of a deleted workspace; nothing implements or tests it), `infra/runbooks/data-ops/`.
- Job convention: definitions live in `packages/core/src/jobs/definitions/*.ts`, registered in `packages/core/src/jobs/registry.ts`, run by the worker (no `apps/worker/src/jobs/` dir). A non-`system.` job must require `workspaceId` (`packages/core/src/jobs/define.ts:104-106`), so the issue's `ops.backup.health` must be `system.backup.health` (precedent `system.audit.retention`, `audit-retention.ts:78`). Registry lists to update: `apps/worker/src/__tests__/registry.test.ts:144-165`, `schedules.test.ts:19-40`, `docs/engineering/jobs.md:124`.
- Metrics API: `meter()` in `packages/observability/src/otel.ts:162`. Core already depends on `@causedeck/observability` and `@causedeck/storage` (`packages/core/package.json:69-70`), so no new workspace dependency.
- Cross-tenant guard: new core runtime exports need `SERVICE_TESTS` or `NOT_A_SERVICE` in `packages/db/src/testing/cross-tenant-registry.ts` (jobs section ~`:1189-1236`).
- Static-lint precedent for infra: `infra/scripts/compose-prod.test.mjs`, `compose-dev.test.mjs`; CI-only runtime precedent: `infra/docker/test/compose-smoke.sh`, `.github/workflows/images.yml` (actions pinned by SHA).

### Root Cause
Greenfield. #97 shipped the archiving hook only; nothing takes base backups, enforces retention or encryption, replicates MinIO, restores, or reports freshness.

### Affected Files
`infra/docker/{compose.prod.yml,postgres/postgresql.conf,postgres/wal-g.env.example,minio/replication.json,env/*.env.example}`, new `infra/scripts/backup/*`, `infra/scripts/restore/*`, `packages/core/src/jobs/definitions/backup-health.ts` (+registry), `.github/workflows/restore-drill.yml`, `infra/runbooks/{restore,dr-hyderabad}.md`, `infra/runbooks/drills/`, docs and registry tests (see contract.json).

### Sibling Sweep
Other places that must stay consistent: `workspace-deletion.md` Backups section (crypto-erase claim), `infra/docker/README.md` production section, `docs/engineering/jobs.md` schedule list, worker registry/schedules tests, cross-tenant registry. Caddy/monitoring alert routing belong to #98/#102 (open), incident runbooks to #103.

### History
WAL archiving hook and WAL-G binary landed in #97 (PR #784, "Restore drills and retention are #101" in `postgresql.conf:22`). No prior backup attempt.

### Recommendation
One lane. Ship scripts with shell-level unit tests (guards, India endpoint validation, retention arithmetic, report schema) and a job with vitest unit tests; the full backup-PITR-restore integration test and the weekly drill run in CI against local MinIO only (never locally on this host). Alert routing is #102: deliver the metrics, thresholds and failing job/log signal, defer wiring.

### Related Issues
#97 (done, dependency), #1 parent, #102 monitoring/alerts, #103 incident runbooks, #106 Stage B/C, #108 VPS, #116 secrets.
