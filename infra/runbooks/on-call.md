# Runbook: on-call

Alerts come from the monitoring stack ([infra/monitoring](../monitoring/README.md)). Incident handling
(CERT-In 6-hour reporting, DPDP breach, key rotation, restore) is in the incident runbooks of #103; this page is
the rotation, the severities and the escalation path.

## Severity

| Priority | Alertmanager route | Meaning                                                                                                         | Response                                                        |
| -------- | ------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| P0       | on-call + fallback | Data loss risk or the product is down (service down, `/readyz` failing, WAL not archived, public endpoint down) | Acknowledge in 15 minutes, any hour                             |
| P1       | on-call + fallback | Degraded for advocates (latency, error spike, queue lag, stale base backup, failed restore drill, clock drift)  | Acknowledge in 30 minutes; inside court-day windows treat as P0 |
| P2       | ticket webhook     | Needs a person within a working day (cert expiry, dead letters, adapter stale, disk 80 %)                       | Next business day                                               |
| Info     | ticket webhook     | Trends                                                                                                          | Weekly review                                                   |

Court-day windows are 07:00-10:30 and 18:00-23:00 IST: thresholds are stricter and every `window=court-day` alert is
handled as P0. Alertmanager mutes `ticket` and `info` notifications between 23:00 and 07:00 IST. It never mutes P0 or P1.

## Rotation

- One primary and one secondary, weekly, handover Monday 10:30 IST (after the morning window).
- The primary receives P0 and P1 on `ONCALL_WEBHOOK_URL`; the fallback receiver (email plus a second webhook) goes
  to the secondary. If the primary has not acknowledged in 15 minutes, call the secondary.
- Escalation after 30 minutes without progress: the engineering lead, then the founder. A suspected security
  incident starts the CERT-In clock (6 hours): follow the #103 runbook and note the detection time.

## First response

1. Open Grafana through the admin gate: Court-Day Windows first, then the dashboard for the firing alert.
2. `docker compose -f infra/docker/compose.prod.yml ps` and the service logs in Grafana (Loki, filter by `service`
   and `request_id`).
3. Logs contain ids only, never matter content. Do not paste user data into tickets or chat.
4. Record what you did in the incident ticket; close it when the alert resolves and the cause is known.

## Housekeeping

- Check monthly: `bash infra/monitoring/log-retention/verify-retention.sh` and that the synthetic alert test passes in CI.
- Receivers are env (`ONCALL_WEBHOOK_URL`, `FALLBACK_WEBHOOK_URL`, `ALERT_EMAIL_TO`): update them when the rotation changes hands.
