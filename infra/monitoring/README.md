# Monitoring, alerting and log retention (Stage A)

Everything here runs in India, on the app VPS or a small monitoring VPS next to it. Nothing is shipped to a
SaaS outside India. Design: [observability.md](../../docs/engineering/observability.md), spike §1, §3, §6.

```bash
export CAUSEDECK_ENV_FILE=/etc/causedeck/prod.env   # adds LOKI_S3_*, GRAFANA_ADMIN_PASSWORD and receivers
# lean (VPS-1 staging, VPS-3 prod at launch): 960 MB of limits
docker compose -f infra/monitoring/compose.monitoring.yml --env-file "$CAUSEDECK_ENV_FILE" --profile core up -d --wait
# everything (Loki, Grafana, collector): 2.5 GB of limits
docker compose -f infra/monitoring/compose.monitoring.yml --env-file "$CAUSEDECK_ENV_FILE" --profile full up -d --wait
```

## Profiles (#886)

No service starts without a profile. Run one profile at a time (`prometheus` and `prometheus-core` share ports);
switch with `down` then `up`.

| Profile | Services                                                                    | Memory limits | Logs                                  |
| ------- | --------------------------------------------------------------------------- | ------------- | ------------------------------------- |
| `core`  | prometheus-core (512 MB), alertmanager, cAdvisor, node-exporter, blackbox   | 960 MB        | Lean archive: daily gzip to an India bucket, 180 days |
| `full`  | the same plus Loki, Grafana and the OpenTelemetry collector; Prometheus 768 MB | 2,496 MB   | Loki, 200 days (as before)            |

`core` loads the same `prometheus/rules` and delivers every alert, including `BackupWalStale`, `BackupBaseStale`
and `RestoreDrillFailed` (#792). Differences from `full`:

- Application metrics reach Prometheus over OTLP with no collector: set
  `OTEL_EXPORTER_OTLP_ENDPOINT=http://prometheus:9090/api/v1/otlp` on the services (the app stack's edge network
  resolves `prometheus` to `prometheus-core`). Metric names are unchanged (`http_server_duration_milliseconds_*`,
  `causedeck_*`). Traces have no receiver on `core`; the exporter logs a benign 404 for the 10 % sampled spans.
- `prometheus.core.yml` omits the Loki and collector scrape jobs (those services do not exist in `core`).
- cAdvisor stays in `core` (192 MB) because `DatabaseCpuHigh` reads container CPU; without it that rule would
  never fire. This is the one deviation from "cAdvisor is full-only".
- No Grafana: use Prometheus on `127.0.0.1:9090` (SSH tunnel) until the host moves to `full`.

| Piece                | Role                                                                        | Config                         |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------ |
| OpenTelemetry Collector | OTLP gRPC `:4317` and HTTP `:4318` in; Docker JSON logs (services, Caddy) in; redaction; metrics out on `:8889`, logs to Loki | `otel-collector.yml`           |
| Prometheus           | Scrapes the collector, cAdvisor, node_exporter, blackbox; evaluates rules   | `prometheus/`                  |
| Alertmanager         | Routes `page` and `ticket` alerts; P0/P1 to on-call plus a fallback          | `alertmanager/alertmanager.yml` |
| Loki                 | Logs, 200 days by default (never below 4320 h), objects on MinIO or S3 ap-south-1 | `loki/loki-config.yml`      |
| Grafana              | Dashboards as code, bound to `127.0.0.1:3030`, reached through the admin gate | `grafana/`                  |
| blackbox_exporter    | `/readyz` of each service and the public app, api, static, site and status URLs | `blackbox.yml`, `prometheus/targets/public.yml` |

Services send telemetry with `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`. Caddy must log JSON to
stdout (the Caddyfile belongs to #98); the collector reads it with every other container's log.

## Alerts and court-day windows

`prometheus/rules/alerts.yml` holds the all-day alerts, `rules/court-day.yml` the stricter ones for 07:00-10:30
and 18:00-23:00 IST (the recording rule `causedeck:court_day_window:active` works in UTC minutes, IST is UTC+5:30).
Each alert has a `severity` (`page`, `ticket`, `info`) and a `priority` (P0, P1). Alertmanager mutes `ticket`
and `info` between 23:00 and 07:00 IST to cut noise and never mutes P0 or P1. Every alert has a promtool case in
`prometheus/tests/alerts.test.yml`. On-call process: [on-call runbook](../runbooks/on-call.md).

Receivers are env: `ONCALL_WEBHOOK_URL` (email, or a WhatsApp-compatible webhook), `FALLBACK_WEBHOOK_URL`,
`ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`, `SMTP_SMARTHOST`, `TICKET_WEBHOOK_URL`. Defaults point at the CI webhook
mock, so set them at deploy. Sentry stays optional: without `SENTRY_DSN` (human issue #115) nothing here changes.

## Log retention (CERT-In, 180 days)

- Loki `limits_config.retention_period` is `4800h` (200 days); a test fails below `4320h`. Per-request deletion is off.
- `log-retention/lifecycle.json`: the log bucket is locked 180 days in COMPLIANCE mode (nobody can delete earlier,
  not even root) and expires objects after 200 days. The 180-day clock starts at object creation.
- `log-retention/verify-retention.sh --fixture` proves logs older than 170 days survive compaction in a
  time-travel fixture; without the flag it checks live Loki (oldest entry is at least 180 days old, or nothing was
  deleted since the first ingest, recorded in `/var/lib/causedeck/monitoring/first-ingest`). Run it monthly.
- The host must run NTP (`chrony`); node_exporter's `node_timex_offset_seconds` drives `ClockDriftHigh` (above 1 s).

## Lean log path (`core` profile, #886)

Without Loki, CERT-In's 180 days of logs are kept as gzip files of Docker's JSON logs in an India bucket. Files in
`log-retention/`:

| File                          | Role                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `logrotate-docker.conf`       | Daily gzip with `copytruncate`; install to `/etc/logrotate.d/causedeck-docker`          |
| `archive-logs.sh`             | Uploads rotated files to `docker/<host>/<date>/<container>.json.log.gz`, deletes each local file after its upload; `--init` creates the bucket with object lock; `--check-config` validates env |
| `archive-lifecycle.json`      | 180-day COMPLIANCE object lock, expiry after 200 days, region `ap-south-2`              |
| `causedeck-log-archive.*`     | systemd service and timer (01:00 UTC) that run the upload                               |

Destination: `LOG_ARCHIVE_REGION` is `ap-south-2` (Hyderabad) by default; only `ap-south-1` and `ap-south-2` pass
(`infra/scripts/backup/lib/india-guard.sh`, tested in `test/log-archive.test.ts`), and the endpoint host must be an
India endpoint. Two targets: the Hyderabad off-host bucket from #884 (`LOG_ARCHIVE_ENDPOINT=https://s3.ap-south-2.amazonaws.com`,
use a prefix-scoped write-only IAM user) or the stack's MinIO (`http://minio:9000` with `ALLOW_LOCAL_ENDPOINTS=1`,
survives only until the host is lost, so prefer off-host). Credentials are `LOG_ARCHIVE_ACCESS_KEY` and
`LOG_ARCHIVE_SECRET_KEY` in the env file, never in the repo. Procedure and evidence retrieval:
[log-archive runbook](../runbooks/log-archive.md).

## Resource limits (Stage A)

Limits are per container and overridable with `*_MEM` and `*_CPUS` (`PROMETHEUS_CORE_MEM` for the lean
Prometheus). Typical use is about a third of the limit. The table is the `full` profile; `core` is prometheus-core
512 MB, cadvisor 192 MB, alertmanager 128 MB, node-exporter 64 MB and blackbox 64 MB (960 MB, 1.1 CPUs), checked by
`test/profiles.test.ts` and, on the rendered config, by `infra/docker/test/compose-smoke.sh`.

| Service        | Memory | CPUs |
| -------------- | ------ | ---- |
| prometheus     | 768 MB | 0.5  |
| loki           | 768 MB | 0.5  |
| otel-collector | 256 MB | 0.25 |
| grafana        | 256 MB | 0.25 |
| cadvisor       | 192 MB | 0.25 |
| alertmanager   | 128 MB | 0.15 |
| node-exporter  | 64 MB  | 0.1  |
| blackbox       | 64 MB  | 0.1  |
| **Total**      | **2.5 GB** | **2.1** |

On the 4 vCPU / 8 GB app VPS the stack adds roughly 1 GB and 0.7 vCPU in practice. If that squeezes the app,
move it to its own 2 vCPU / 4 GB India VPS (about the cost of the smallest instance) and point `APP_NETWORK` at a
private link. That is the Stage A cost target: no new paid service.

## Disk and retention growth model

Assumptions per seat per day: 300 API requests, 600 log lines (requests, jobs, Caddy access), 350 bytes of JSON
per line, Loki compression about 8x, index about 10 % of chunks. Metrics: 15,000 series at 30 s, 1.5 bytes per sample.

| Seats | Raw logs/day | Loki/day | Logs at 200 days | Prometheus at 30 days |
| ----- | ------------ | -------- | ---------------- | --------------------- |
| 10    | 2 MB         | 0.3 MB   | 60 MB            | 2 GB                  |
| 100   | 21 MB        | 3 MB     | 0.6 GB           | 2 GB                  |
| 1,000 | 210 MB       | 29 MB    | 5.8 GB (about 6 GB) | 2 GB (cap 8 GB)    |

Provision 3x for bursts and verbose incidents: about 20 GB of object storage for logs at 1,000 seats, plus 10 GB
for Prometheus. Locked objects cannot be freed early, so size the bucket for the full 200 days. Beyond 1,000 seats
(Stage B) logs move to S3 ap-south-1 with the same lifecycle file, growing linearly at about 6 MB per seat per
200 days.

## Tests

`pnpm test:monitoring` (static checks, profiles, the log-archive guard and the retention fixture), `promtool test rules` and the config checks in
`.github/workflows/monitoring.yml`, which also runs `test/synthetic-alert.sh`: a synthetic P0 and P1 must reach the
on-call and fallback receivers through the webhook mock.
