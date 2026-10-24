# 0035. Data operations alerting

## Status

Proposed

## Date

2026-10-23

## Context

The governed fetch layer (ADR 0034) reads external sources that block, change layout and cost money. Staff need to hear about a stale, failing, blocked, mis-parsed, expensive or conflicting source before an advocate does, and the platform should back off a blocked source by itself (#515, D-049).

## Decision drivers

- SLOs belong to the source registry row, and a source without one is simply not judged.
- Detectors must be testable without a database or a clock.
- One alert per incident, one notice on open and one on resolve.
- Only `packages/fetch` may call an external host (#479).

## Considered options

| Option                                                         | Verdict  | Reason                                                             |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| Nullable SLO columns on `source`                               | Chosen   | The registry is the per-source row; null means no objective        |
| A separate SLO table                                           | Rejected | A second join for three numbers per source                         |
| Pure detectors over metrics, run by a 15-minute scheduled job  | Chosen   | Inputs are counts and dollars already in `fetch_log`; replica-safe |
| Detectors inside the fetcher                                   | Rejected | The fetcher has no history; freshness and cost are not per-call    |
| Slack POST from core through `postWebhook` in `packages/fetch` | Chosen   | Keeps the external-host lint ban whole; the host is allow-listed   |
| A Slack client in core                                         | Rejected | Breaks the #479 ban                                                |

## Decision

- `source` gains `slo_freshness_minutes`, `slo_success_rate` and `slo_parse_yield_floor`. Four global, content-free tables hold the rest: `source_health` (degraded state, backoff, quarantined parser version), `source_parse_run`, `data_ops_alert` (one open row per `<type>:<source>` key, enforced by a partial unique index) and `data_ops_oncall` (the rotation). The app role never gets DELETE.
- Detectors: freshness, error rate (last hour), block signature (403, 429, challenge page), parse yield, cost against the 7-day daily baseline (three times and at least $0.50) and conflict rate (above 10% of at least 20 records).
- An alert opens once and notifies once; a repeat breach refreshes `last_seen_at`; the first clean verdict resolves it and notifies once. A notice that reached no channel leaves `notified_at` null and is retried.
- Routing goes to Slack (`DATA_OPS_SLACK_WEBHOOK_URL`) and email (`DATA_OPS_ALERT_EMAIL` plus the on-call member), or the log when neither is set. Every alert row carries its runbook link (`infra/runbooks/data-ops/runbook.md`).
- The fetcher takes an optional health port: it refuses a backed-off source with `source_backed_off` before any network call and reports block signatures. A block backs the source off (15 minutes, doubling to 6 hours) and marks it degraded; a parse-yield drop quarantines the parser version into the review queue. Both clear on recovery.

## Consequences

- Core gains a dependency on `@causedeck/fetch` for `postWebhook` only.
- Challenge pages are detected on the live response only; `fetch_log` keeps status codes, so the block detector sees 403 and 429 from history and challenge pages through `source_health`.

## Revisit when

- A second alert channel (pager, SMS) is needed, or Slack and email prove too noisy to route by alert type alone.
- Per-source objectives need history or per-court overrides (move the SLO columns to their own table).
- The staff Data Ops console (`/data-ops`) should own acknowledgement and snooze of alerts, not only display them.
- Counsel clears alerting that quotes any source content (today an alert carries counts and source ids only).
