**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (launch-blocking compliance documents; no runtime defect)
**Task Type**: docs

### What Was Claimed
Issue #103 asks for the incident and key-rotation runbooks (CERT-In 6h, DPDP breach, key rotation, restore/DR, on-call, court-day-freeze link), templates, drill records, `rotate-kek.sh`, `evidence-export.sh`, an ADR and a CI check (`links.test.ts`) for headings, owner, `Last drilled`, internal links and secrets. 11 acceptance criteria.

### What We Found
- Base `origin/milestone/production-infra-scale` = HEAD (15297f35). #101 and #102 are merged, so both dependencies are met.
- Already present (from #101/#102): `infra/runbooks/restore.md`, `dr-hyderabad.md`, `on-call.md`, `drills/README.md`, `workspace-deletion.md`, `data-ops/runbook.md`. None has the required headings (Purpose, Triggers, Roles, Steps, Communications, Evidence, Verification, After action), an owner or `Last drilled` (`restore.md:1-69` headings are ad hoc; `on-call.md:1-38`). `on-call.md:3-4` and `:24-26` defer to "the #103 runbook". `drills/README.md:5-17` defines a restore-only drill format, with no `TEMPLATE.md`.
- Missing: `infra/runbooks/{README,cert-in-6h,dpdp-breach,key-rotation,court-day-freeze}.md`, `templates/`, `test/`, `infra/scripts/runbooks/`, and the ADR. Last ADR is `docs/adr/0036-bench-facts.md`, so the next is 0037.
- Evidence source: Loki, 180-day retention (`infra/monitoring/loki/loki-config.yml:1`, `infra/monitoring/log-retention/verify-retention.sh:9-12`), object store bucket `causedeck-logs` (`infra/monitoring/compose.monitoring.yml:121`).
- KEK rotation is already implemented in code: `rewrapAll` and `pendingRewrap` (`packages/storage/src/workspace-crypto.ts:138-180`), `EnvKeyProvider.fromEnv(env, previous)` (`packages/storage/src/crypto/kek.ts:64-66`) and the `KEK_BASE64` env (`packages/config/src/env/schema.ts:160,471`). The tests are in `packages/storage/src/__tests__/rotation.test.ts` (DB-backed, Testcontainers). It has no test that the old KEK is rejected once dropped from the provider.
- Test precedent for infra: node:test with `--experimental-strip-types`, an `index.js` aggregator and a path-filtered workflow (`infra/monitoring/test/index.js`, `.github/workflows/monitoring.yml:1-30,59`). Shell scripts are tested via spawnSync (`infra/monitoring/test/verify-retention.test.ts`). Backup scripts use `infra/scripts/backup/lib/india-guard.sh`, which can be reused for the evidence archive endpoint.
- Secret scanning: gitleaks already scans the whole repo history in `.github/workflows/security.yml:33-48` (config `.gitleaks.toml`), which covers `infra/runbooks/`. No runbook-scoped check exists.
- `tsx` is only a dependency of db, auth and ui (`packages/*/package.json`), not storage.

### Root Cause
Greenfield. #97, #101 and #102 shipped the tooling; the operational procedures, templates, drills and rotation/evidence scripts were deferred to #103.

### Affected Files
New under `infra/runbooks/`: README, cert-in-6h, dpdp-breach, key-rotation, court-day-freeze, templates/*, drills/TEMPLATE.md plus drill records, test/. Edited: restore.md, dr-hyderabad.md, on-call.md (and, if checked, workspace-deletion.md and data-ops/runbook.md). New: `infra/scripts/runbooks/{rotate-kek.sh,evidence-export.sh}` with tests, `docs/adr/0037-incident-and-key-rotation-policy.md`, `.github/workflows/runbooks.yml`, a storage rotation test. Details are in contract.json.

### Sibling Sweep
- `workspace-deletion.md:65-69` and `restore.md:69` (crypto-erase and backups) must stay consistent with key-rotation.md.
- `docs/adr/README.md` index, `infra/monitoring/README.md` and `infra/docker/README.md` link to runbooks.
- The restore and DR runbooks must cite RPO ≤ 15 min and RTO ≤ 4 h (`restore.md:3-4`) and the drill reports in `drills/`. No measured drill report exists yet (#101 reports are produced by CI). Link the workflow artifact and the `drills/` dir; do not invent measurements.
- The guard list in `CLAUDE.md` does not apply: there are no core exports, actions, tables or jobs.

### History
`restore.md`, `dr-hyderabad.md`, `on-call.md` and `drills/README.md` came from #101 and #102 (PRs #793, #791) and explicitly point at #103. No prior attempt at #103.

### Recommendation
One lane, documentation-heavy. Order: ADR; templates and drills/TEMPLATE; the runbooks, all with the required heading set; `links.test.ts` (headings, owner, Last drilled, links, secret patterns, no-auto-send statement, `Counsel to confirm` markers); evidence-export.sh with a node test over seeded fixtures. The test starts a local fake Loki HTTP server and writes to a local directory/MinIO-stub, with the India guard applied to the real endpoint. rotate-kek.sh invokes a TS entry through `pnpm --filter @causedeck/db exec tsx` (or similar) that calls `rewrapAll`. CI coverage for "all documents decrypt and the old KEK is rejected" goes in a new vitest in `packages/storage` (runs in CI with Testcontainers; not locally on this host, or only that one file). Real tabletop and technical drills cannot be run by an agent: ship drill records marked as scheduled (`Last drilled: not yet drilled`, status pending) and defer the actual drills as a tracked follow-up. Counsel wording stays `Counsel to confirm` (#117). A runbook `Last drilled` field must be accepted as a date or the literal `not yet drilled` pre-launch, with the launch check noted in the README.

### Related Issues
#101, #102 (dependencies, done), #117 (counsel wording), #100 (court-day-freeze owner), #104 (scanning), #1 (parent).
