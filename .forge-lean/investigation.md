**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (partial baseline exists; security gates, custom SAST, ZAP, CSP reporting and exception handling are missing)
**Task Type**: feature

### What Was Claimed
Add security automation: dependency, secret, SAST and container scanning, a ZAP baseline against a staging-like stack, CSP violation reporting (`POST /v1/csp-report`, `csp_violations_total`), a weekly report, SBOMs, an exceptions process and a vuln-triage runbook. 13 acceptance criteria.

### What We Found
- `.github/workflows/security.yml:21-99`: jobs `audit` (`pnpm audit:prod`, no exceptions file), `gitleaks` (digest-pinned docker, full history), `codeql` and `dependency-review` (both opt-in via `ENABLE_GHAS`, D-043), weekly cron Mon 02:30 UTC (`security.yml:16`). No Semgrep, no Trivy fs scan, no weekly report, no no-l5 step.
- `package.json:43` `audit:prod` is `pnpm audit --prod --audit-level high`: fails on any high/critical, with no fix-available filter and no exception mechanism. `infra/security/` does not exist.
- `.github/dependabot.yml`: weekly, one `catalog` group for npm plus github-actions; no `applies-to: security-updates` group and no documented policy.
- `.gitleaks.toml:6-12`: default rules plus a case-number allowlist; no allowlist for `.env.example` / `infra/docker/env/*.env.example`. `lefthook.yml` pre-commit has only prettier and eslint (no gitleaks). No seeded-secret test.
- `.github/workflows/images.yml:33-34,166-187`: Trivy (`--severity CRITICAL --ignore-unfixed`), CycloneDX SBOM and cosign sign/attest already run for main builds. No `infra/security/trivy/` config or ignore file with expiry; SBOM is attested, not attached to a release; no deploy workflow verifies the signature.
- `scripts/check-no-l5.ts` and `pnpm check:no-l5` (`package.json:32`) exist and run in `.github/workflows/ci.yml:70`; the test is `packages/core/src/automation/no-l5.test.ts`. Not run in security.yml; `packages/config/test/no-l5.test.ts` does not exist.
- No `/v1/csp-report`: `apps/api/src/routes/` has `inbound-email.ts`, `inbound-whatsapp.ts`, `v1/`, `webhooks/`; routers mount in `apps/api/src/routes/v1/index.ts:44-75`; rate-limit and body-limit groups are path-prefix maps (`apps/api/src/app.ts:126-133`, `middleware/rate-limit.ts:55`, `middleware/body-limit.ts:19`). `csrf` only blocks cookie principals (`middleware/cors.ts:43`), so an anonymous report POST passes.
- `packages/observability/src/otel.ts:162` exports `meter()`; no `csp_violations_total` exists.
- CSP: web builds a nonce CSP with no `report-uri`/`report-to` (`apps/web/lib/csp.ts:14-30`, used by `apps/web/proxy.ts:50`); Caddy `strict_csp` (`infra/caddy/snippets/security-headers.caddy:17`) has none and no `Reporting-Endpoints` header; `infra/caddy/README.md:35` says "CSP report collection is #104". `infra/caddy/test/caddyfile.test.mjs:77-81` asserts app/admin carry no Caddy CSP (must stay true).
- No ZAP config or workflow; no Semgrep rules. `infra/docker/compose.prod.yml` and `infra/docker/test/compose-smoke.sh` exist (CI-launched stack precedent). `infra/runbooks/` has no `vuln-triage.md`.
- E2E tests live under `e2e/tests/<area>/` (`e2e/playwright.config.ts:91` `testDir: './tests'`), so the issue's `e2e/security/csp.spec.ts` must be `e2e/tests/security/csp.spec.ts`.
- API OpenAPI is checked in (`apps/api/package.json:14-15` `openapi:check`; `apps/api/src/__tests__/openapi-file.test.ts`): a documented new route requires regenerating it.

### Root Cause
Greenfield beyond the #3/#98 baseline: scanners that were cheap to add exist (audit, gitleaks, Trivy, cosign); the policy layer (exceptions with expiry, custom rules, ZAP, CSP reporting, reporting, runbook) was never built.

### Affected Files
`.github/workflows/security.yml`, new `semgrep.yml`, `zap-baseline.yml`; `.github/dependabot.yml`, `.gitleaks.toml`, `lefthook.yml`; new `infra/security/{exceptions.yml,semgrep/,zap/,trivy/,sbom/}`; new gate scripts under `scripts/`; `apps/api/src/routes/csp-report.ts` + `routes/v1/index.ts`/`app.ts` wiring + OpenAPI file; `apps/web/lib/csp.ts`/`proxy.ts`; `infra/caddy/snippets/security-headers.caddy` (+ caddy test, README); `infra/runbooks/vuln-triage.md`; `docs/engineering/ci.md`; `e2e/tests/security/csp.spec.ts`; `packages/config/test/no-l5.test.ts`.

### Sibling Sweep
- Every workflow pins actions by SHA and docker images by digest (actionlint in `lint-workflows.yml`); new workflows must follow.
- Other public ingress routes (`inbound-email.ts`, `webhooks/razorpay.ts`) set the pattern for anonymous routers, size caps and per-prefix limits; reuse it.
- Gitleaks allowlists and `.gitleaksignore` are history-based: the new fixture secret must live outside scanned paths or be allow-listed explicitly.

### History
Security workflow from #3 (PR #146 touched `.github/workflows/security.yml`); Caddy and the nonce-CSP decision from #98 (PR #789); images/Trivy/cosign from #97 (PR #784). No prior CSP-report attempt.

### Recommendation
One lane, roughly 35 files (under the split threshold). Keep pure logic in testable scripts (audit gate, exception expiry, ZAP host allowlist, trivy ignore expiry, semgrep fixture completeness) with node tests, and wire them into workflows. Actual ZAP, Semgrep, Trivy, CodeQL and cosign runs are CI-only. Do not weaken the existing opt-in GHAS jobs (D-043).

### Related Issues
#1 (parent), #3 and #98 (done), #97 (images), #100 (deploy, owns cosign verify wiring), #102 (monitoring consumes `csp_violations_total`), #103 (incident runbooks), #116 (environment secrets).
