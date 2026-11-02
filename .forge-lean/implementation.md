### Approach
Per-arch WAL-G asset name in the postgres Dockerfile (amd64 22.04, arm64 20.04 aarch64). Recovery pass: examined the failed CI checks; none touch this change.
### Changes
- infra/docker/postgres/Dockerfile: per-arch `asset` variable plus comment on the choice
- .github/workflows/images.yml: comment naming both assets
- infra/docker/base/README.md: runbook note and v3.0.5 checksums
- infra/scripts/compose-prod.test.mjs: asserts the asset names and that no 22.04 aarch64 URL remains
### Acceptance Criteria Status
- R1 ✅ infra/docker/postgres/Dockerfile:18-21
- R2 ✅ Dockerfile:18 (amd64 asset unchanged)
- R3 ✅ infra/scripts/compose-prod.test.mjs:180-183
- R4 ✅ Dockerfile:18-19
- R5 ✅ Dockerfile:15, infra/docker/base/README.md:22-26
- R6 ✅ compose-prod.test.mjs:180-183
### Verification
- `node --test infra/scripts/compose-prod.test.mjs`: exit 0 (30 pass); the new assertions fail on the pre-fix Dockerfile.
- CI failures on PR #1103 are unrelated to this diff and no code change was made for them: e2e (1/2) activity visual baselines (activity-feed/audit-feed specs), core whatsapp-otp-send test (#711), and the api image 250 MB size budget. The diff touches only the postgres Dockerfile, docs and the infra test. They need a rerun or the owners of those areas.
### Notes
No behavior change outside the arm64 postgres image build. The WALG_SHA256_ARM64 repo variable must hold the 20.04 aarch64 checksum (listed in the README).

### CI recovery (run 41403306655)
Failure: core `whatsapp-otp-send.test.ts` "limits sends per number, across members" (RATE_LIMITED). Unrelated to this diff (infra only; the other 2336 core tests pass). No code change; recorded as an amendment in result.json. V1 re-run: pass.
