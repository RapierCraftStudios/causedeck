# Runbook: on-call

Owner: Engineering lead
Last drilled: not yet drilled

## Purpose

Alerts come from the monitoring stack ([infra/monitoring](../monitoring/README.md)). Incident handling
is in [cert-in-6h](cert-in-6h.md), [dpdp-breach](dpdp-breach.md), [key-rotation](key-rotation.md),
[restore](restore.md) and [dr-hyderabad](dr-hyderabad.md); this page is the rotation, the severities and the
escalation path.

## Triggers

Any Alertmanager notification, a customer report, or a suspected security or privacy event.

## Roles

Primary and secondary on-call, incident commander (the primary unless handed off), engineering lead, founder.

## Severity

| Priority | Alertmanager route | Meaning                                                                                                         | Response                                                        |
| -------- | ------------------ | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| P0       | on-call + fallback | Data loss risk or the product is down (service down, `/readyz` failing, WAL not archived, public endpoint down) | Acknowledge in 15 minutes, any hour                             |
| P1       | on-call + fallback | Degraded for advocates (latency, error spike, queue lag, stale base backup, failed restore drill, clock drift)  | Acknowledge in 30 minutes; inside court-day windows treat as P0 |
| P2       | ticket webhook     | Needs a person within a working day (cert expiry, dead letters, adapter stale, disk 80 %)                       | Next business day                                               |
| P3       | ticket webhook     | Improvement, trend or documentation gap                                                                         | Weekly review                                                   |

Court-day windows are 07:00-10:30 and 18:00-23:00 IST: thresholds are stricter and every `window=court-day` alert is
handled as P0. Alertmanager mutes `ticket` and `info` notifications between 23:00 and 07:00 IST. It never mutes P0 or P1.

## Steps

### Rotation

- One primary and one secondary, weekly, handover Monday 10:30 IST (after the morning window).
- The primary receives P0 and P1 on `ONCALL_WEBHOOK_URL`; the fallback receiver (email plus a second webhook) goes
  to the secondary. If the primary has not acknowledged in 15 minutes, call the secondary.
- Escalation after 30 minutes without progress: the engineering lead, then the founder. A suspected security
  incident starts the CERT-In clock (6 hours): follow [cert-in-6h](cert-in-6h.md) and note the detection time.
- Escalation ladder: primary (15 min) → secondary (30 min) → engineering lead → founder; counsel joins for any
  security or privacy incident.
- Handoff (Monday 10:30 IST): open incidents and their clocks, muted alerts, pending changes, anything odd in the
  last week, written in the ticket queue, acknowledged by the incoming primary.

### First response

1. Open Grafana through the admin gate: Court-Day Windows first, then the dashboard for the firing alert.
2. `docker compose -f infra/docker/compose.prod.yml ps` and the service logs in Grafana (Loki, filter by `service`
   and `request_id`).
3. Logs contain ids only, never matter content. Do not paste user data into tickets or chat.
4. Record what you did in the incident ticket; close it when the alert resolves and the cause is known.

### Housekeeping

- Check monthly: `bash infra/monitoring/log-retention/verify-retention.sh` and that the synthetic alert test passes in CI.
- Receivers are env (`ONCALL_WEBHOOK_URL`, `FALLBACK_WEBHOOK_URL`, `ALERT_EMAIL_TO`): update them when the rotation changes hands.

## Communications

- **Public status page**: post within 30 minutes of a P0 or a court-day-window P1 confirmed to affect advocates;
  update at least hourly, and on recovery.
- **WhatsApp support line**: during court-day windows (07:00-10:30 and 18:00-23:00 IST) a person staffs it, and a
  human replies with the approved holding statement; outside the windows, the status page covers it.
- Customer-specific notices (data involved): [dpdp-breach](dpdp-breach.md) and the
  [customer notice](templates/customer-notice.md).
- No automated outbound messages go to courts or any third party; every notice is approved by a human and sent by
  a human after approval (no auto-send).

## Evidence

The incident ticket with times, actions and approvals; Grafana links; for security events the export from
`infra/scripts/runbooks/evidence-export.sh` ([evidence checklist](templates/evidence-checklist.md)).

## Verification

The alert resolved, `/readyz` is green, the Court-Day Windows dashboard is quiet for 30 minutes and the
secondary agrees.

## After action

[Post-incident review](templates/post-incident-review.md) within 5 working days for every P0/P1; update the
runbooks and `Last drilled`.
