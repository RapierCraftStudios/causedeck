**Verdict**: CONFIRMED
**Confidence**: high
**Severity**: medium (greenfield Stage A monitoring; CERT-In 180-day log retention is a compliance obligation)
**Task Type**: feature

### What Was Claimed
Add an India-resident monitoring stack (Prometheus, Grafana, Loki, Alertmanager, OTel Collector, cAdvisor, node_exporter, blackbox) with promtool-tested alerts, 180-day tamper-resistant log retention, content redaction, court-day dashboards/thresholds, on-call routing, optional Sentry, adapter-health metrics and capacity docs (13 acceptance criteria).

### What We Found
- `infra/monitoring/` does not exist on base; `infra/runbooks/` holds only `data-ops/` and `workspace-deletion.md` (no `on-call.md`).
- `infra/docker/compose.prod.yml:16-21` defines networks `edge` and `data` (internal); no monitoring services, no log driver config. Caddy is a placeholder owned by #98 (`infra/caddy/Caddyfile:1-3`, no log directive).
- `packages/observability/src/redact.ts:12-19` `CONTENT_KEYS` = content,text,body,quote,prompt,memoryValue: missing `title`, `filename`, `email`; secret pattern `:9` already covers token/authorization.
- `packages/observability/src/logger.ts:96-123`: base fields `service`, `env`; mixin emits camelCase `requestId`, `workspaceId` (no `request_id`/`workspace_id`, no trace/span ids).
- `packages/observability/src/otel.ts` exports OTLP over HTTP (`exporter-*-otlp-http`); no adapter metrics exist anywhere (`adapter_parse_success_ratio` / `adapter_last_success_timestamp` grep: none).
- `packages/observability/src/sentry.ts:29-41` `beforeSend` already scrubs request data/user email; Sentry inert without DSN (`:20-24`).
- `packages/observability/src/health.ts:106-152` already has a clock-drift readiness check (`createClockDriftCheck`, 1 s), so only the host-level alert (node_exporter `node_timex_offset_seconds`) and chrony/NTP guarantee are missing.
- Test precedent: node tests over compose text `infra/scripts/compose-dev.test.mjs`, `compose-prod.test.mjs`, run by `package.json:31` `test:ci-scripts`. `promtool` is not installed locally.
- Stale `.forge-lean/*` files from other issues were replaced.

### Root Cause
Greenfield: Stage A observability collection/alerting/retention was specified (spike §1, §6) but never built; instrumentation (#13) and prod compose (#97) exist but nothing collects them.

### Affected Files
New: `infra/monitoring/**` (compose, prometheus + rules + promtool tests, alertmanager, loki, otel-collector, blackbox, grafana provisioning/dashboards, log-retention, tests, README with limits and growth model), `infra/runbooks/on-call.md`. Changed: `packages/observability/src/redact.ts` (+test), `logger.ts` (snake_case + trace ids), new `adapter-metrics.ts`, `package.json` (`test:ci-scripts` already globs `infra/scripts` only; add monitoring test script).

### Sibling Sweep
Same content-leak class: `sentry.ts` and `otel.ts` share `redact.ts`, so new content keys cover all three. OTel Collector redaction processor must mirror `CONTENT_KEYS`; a test should assert the lists match. Caddy JSON access logs must drop `Authorization`/`Cookie` headers and URL query.

### History
`redact.ts` from the observability foundation (#13); prod compose from #97 (b210fd3a). No prior monitoring attempt.

### Recommendation
Single lane (~35 mostly independent config files, under split threshold). In-lane checks: node tests that parse configs (retention >= 4320h, India endpoint, rule coverage, route wiring), vitest for redaction/logger/adapter metrics, `verify-retention.sh` against a fixture/mock mode. promtool, e2e leak run, Grafana-behind-admin and live delivery are CI/out-of-band (promtool via pinned prom image in CI).

### Related Issues
#1 (parent), #13 and #97 (deps, done), #96 (status page, closed not_planned), #98 Caddy, #101 backups (metrics source), #103 runbooks, #115 Sentry DSN (human).
