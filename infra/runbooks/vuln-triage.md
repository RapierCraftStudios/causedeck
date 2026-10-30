# Vulnerability triage

How findings from the security automation (#104) are handled. Tooling is described in
`docs/engineering/ci.md`.

## Time to fix

| Severity | Fix or reviewed exception within |
| -------- | -------------------------------- |
| Critical | 48 hours                         |
| High     | 7 days                           |
| Medium   | 30 days                          |

The clock starts when a scanner reports the finding (PR check, weekly report, ZAP, Semgrep or Trivy). Low
findings are fixed with the next routine update. Critical and high findings with a fix fail CI, so they
block merge; findings without a fix are tracked in the weekly report until one exists.

## Exceptions

A finding that cannot be fixed in time is waived, never ignored:

- Dependencies: an entry in `infra/security/exceptions.yml` with `id` (GHSA, CVE or audit id), `package`,
  `reason` (why it is not exploitable here and what the plan is), `owner` (GitHub login) and `expires`
  (a date no more than 90 days ahead).
- Images: an entry in `infra/security/trivy/.trivyignore.yaml` with `expired_at` and a `statement`.
- ZAP: a row in `infra/security/zap/suppressions.tsv` (plugin id, reason, expiry).
- Semgrep: a reviewed path exclusion in `infra/security/semgrep/rules.yml`, with the reason in the PR.

A second reviewer approves every exception in the PR that adds it. An expired exception fails the build
(`audit-gate` and `trivy.test.mjs`) and shows up in the weekly report, so it is renewed with a new review or
removed because the fix landed.

## Weekly report

`Security / weekly report` runs on Mondays and writes open advisories and exceptions to the run summary and
to the open issue "Weekly security report". The on-call engineer reads it, assigns an owner to each open
item and checks the times above.

## Cross-tenant suite

The cross-tenant suite (`packages/core/src/__tests__/cross-tenant`, `apps/web/__tests__/cross-tenant-actions.test.ts`)
must stay green on every PR. A fix for a finding never merges with it skipped or loosened; a failing
cross-tenant test is treated as a critical finding.

## CSP reports

Browsers send CSP violations to `POST /v1/csp-report`. The API logs one line per report (`csp violation
reported`, with directive, blocked URL, document URL and disposition; query strings and fragments are
removed) and increments `csp_violations_total{directive}`. Nothing is stored. Triage a new directive or a
rising count as a medium finding: a script-src violation on a page we ship is a bug or an injection attempt;
a blocked URL with a browser-extension scheme is noise.
