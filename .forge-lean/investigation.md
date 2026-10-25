**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (no outage today; the scale path is undocumented and uncodified, so a trigger firing would force an unplanned migration)
**Task Type**: feature

### What Was Claimed
Issue #106 asks for the Stage B/C scale-out runbooks, plan-able (never applied) Terraform modules (RDS, S3, ALB, optional Cloudflare LB, ECS/ElastiCache skeletons, `envs/stage-b`), migration scripts (Postgres to RDS, MinIO to S3), S3 provider conformance tests proving env-only provider swap, `scale-readiness-check.ts`, an ADR, and a CI extension of `terraform.yml`. 13 acceptance criteria. The migration itself, Stage A backups (#101), base Terraform (#99) and load tests (#105) are out of scope.

### What We Found
- #99 and #101 are merged on the base (`origin/milestone/production-infra-scale` = `15297f35`, same as HEAD). Terraform layout exists: `infra/terraform/modules/{cloudflare-access,cloudflare-pages,cloudflare-static-cdn,cloudflare-waf,cloudflare-zone,vps-do-blr1,vps-lightsail-mumbai}`, `envs/{prod,staging}`, `backend.tf.example`, `infra/terraform/README.md:1-30`.
- None of the issue's deliverables exist: no `aws-*`, `cloudflare-lb`, `envs/stage-b`, `infra/scripts/stage-b/`, `scale-readiness-check.ts`, `stage-b-scale-out.md`, `stage-c-orchestration.md`. Last ADR is `docs/adr/0036-bench-facts.md`; next free number 0037.
- `.github/workflows/terraform.yml:41-67` (static job: policy node test, fmt, validate and `terraform test` for staging/prod only, tflint, checkov) and `:69-117` (plan matrix `[staging, prod]`, dummy AWS creds) must be extended with `stage-b`. Apply is `workflow_dispatch` gated by `environment: terraform-<env>` (`:155-190`); Stage B must reuse that gate (apply inputs `options: [staging, prod]` at `:15-20`).
- Policy lint precedent: `infra/terraform/test/policy.test.mjs` (text-based HCL block parser, `blocks()` at `:21-39`, ENVS list `:15`) plus `residency.tftest.hcl`; run in CI and by `pnpm test:ci-scripts` (`package.json:31` globs `infra/terraform/test/*.test.mjs`). New module policy tests fit here (or a sibling file in that dir).
- Residency precedent to mirror for the Cloudflare LB: #99 K3, `app_proxied` false unless `residency_decision_ref` non-empty (`infra/terraform/README.md` variables table, `envs/prod/variables.tf`).
- Storage: the provider is `packages/storage/src/s3-provider.ts` (not `providers/s3.ts` as the issue says). `createObjectStoreFromEnv` and `StorageEnv` exist (`__tests__/s3-provider.test.ts:11-20`). The shared contract `objectStoreContract(name, harness)` is in `__tests__/object-store.contract.ts:23`, already run against MinIO via Testcontainers (`__tests__/minio.test.ts:24-40`) and the memory provider. No S3-compatible mock target runs the same suite, and no test proves the swap needs only env changes.
- Envelope encryption: `packages/storage/src/crypto/kek.ts` has the `KeyProvider` seam (KEK from `KEK_BASE64`, rotation list), `docs/engineering/storage.md:14-50` states "Stage B: AWS KMS". No dedicated key-rotation runbook file exists; rotation text is in `storage.md` and `infra/runbooks/restore.md:34`.
- Health endpoints exist: web `apps/web/app/readyz/route.ts:9`, API `apps/api/src/app.ts:92-98` (health handlers). Needed for ALB health checks and the readiness check.
- Script tooling precedent: TS scripts run via Node type stripping (`package.json:14`, `infra/scripts/doctor.ts:1-2`, `infra/scripts/tsconfig.json`), tests in `infra/scripts/*.test.ts` (picked up by `test:ci-scripts`). Shell precedent: `infra/scripts/backup/*.sh`, `infra/scripts/restore/*.sh`, `infra/scripts/backup/lib/india-guard.sh`, tests `infra/scripts/backup/test/backup.test.mjs`.
- Existing runbooks to cross-link: `infra/runbooks/{restore.md,dr-hyderabad.md,on-call.md,workspace-deletion.md}`; verification SQL reusable from `infra/scripts/restore/verify.sql`.
- PRD cost target: `docs/product/03-prd.md:335` (≤ ₹175 variable cost per active seat per month at launch, ≤ ₹110 by month 6).
- Day-one rules source: `docs/engineering/13-technical-architecture-spike.md:125`.

### Root Cause
Greenfield. The spike (#1 §3.2, §3.3, §6, §11) specified Stage B/C but only Stage A infra (#97, #99, #101) was built; there is no runbook, IaC, migration tooling or automated guard that the day-one rules still hold.

### Affected Files
New: `infra/runbooks/stage-b-scale-out.md`, `infra/runbooks/stage-c-orchestration.md`, `infra/terraform/modules/{aws-rds-postgres,aws-s3-documents,aws-alb-multinode,cloudflare-lb,aws-ecs-fargate,aws-elasticache}/`, `infra/terraform/envs/stage-b/`, `infra/scripts/stage-b/{migrate-postgres-to-rds.sh,migrate-minio-to-s3.sh}`, `infra/scripts/scale-readiness-check.ts` (+test), `docs/adr/0037-stage-b-c-scale-path.md`, storage conformance test(s). Changed: `.github/workflows/terraform.yml`, `infra/terraform/README.md`, `infra/terraform/test/policy.test.mjs` (or new sibling test), `packages/storage/src/__tests__/*`, `docs/engineering/storage.md` (KMS note), `package.json` (script entry).

### Sibling Sweep
- Every Terraform region variable must validate to `ap-south-1`/`ap-south-2` (policy test covering all new modules, as `policy.test.ts` does for #99 modules).
- `workspace-deletion.md` and `restore.md` crypto-erase and key claims must stay consistent with the KMS DEK re-wrap description.
- `infra/docker/README.md` and `docs/engineering/13-technical-architecture-spike.md` link the scale path: add backlinks only if trivial.
- `terraform.yml` drift and apply jobs enumerate `[staging, prod]`; do not add `stage-b` to apply or drift (nothing applied automatically).
- Core exports: no new `@causedeck/core` runtime exports are planned, so the cross-tenant registry is untouched.

### History
`terraform.yml` and base modules from #99 (PR #790); backups and drill tooling from #101 (PR #793); storage provider and envelope crypto from earlier storage issues. No prior attempt at Stage B/C. Linked context shows #99/#101 lanes had conformance regressions on scope creep and omission, so every acceptance item must be mapped explicitly.

### Recommendation
One lane, ordered: (1) ADR + runbooks; (2) modules with variable validation and policy tests; (3) `envs/stage-b` + example tfvars + workflow plan job; (4) scale-readiness script with tests; (5) storage conformance against an S3-compatible in-process mock; (6) migration scripts with dry-run/guard shell tests. Terraform cannot run locally (docker/tools unavailable on host): verify with node policy tests only; CI runs fmt/validate/plan. The two rehearsals need real staging data and are post-deploy; ship scripts plus a rehearsal results section in the runbook that is filled after the run.

### Related Issues
#1 parent, #99 and #101 (dependencies, done), #105 (load tests/triggers), #108 (VPS), #112 (AWS access), #116 (gated apply environments), #102/#103 (alerts, incident runbooks).
