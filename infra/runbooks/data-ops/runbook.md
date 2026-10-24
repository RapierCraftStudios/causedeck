# Data operations runbook

Every data-ops alert (#515, [ADR 0035](../../../docs/adr/0035-data-ops-alerting.md)) links to one entry below. The alert names the source and the on-call staff member; the numbers in it come from `fetch_log` and `source_parse_run`. An alert resolves itself when its detector is clean again.

## Freshness breach

The source has had no 2xx fetch within its `slo_freshness_minutes`.

1. Check `fetch_log` for the source: are calls being made at all? If not, the schedule or the adapter is stopped.
2. If calls fail, follow [error-rate spike](#error-rate-spike) or [block signature](#block-signature).
3. If the source is killed in the registry, that is deliberate: set its SLO to null or lift the kill switch.

## Error-rate spike

The success rate over the last hour is below `slo_success_rate`.

1. Group the hour's `fetch_log` rows by status: 0 is a provider failure, 5xx is the source being down.
2. For a source outage, wait and watch; the alert resolves when the rate recovers.
3. For provider failures, check the AlterLab status and the tier and cost caps on the source row.

## Block signature

A 403, a 429 or a challenge page was seen. The fetcher has already backed the source off (15 minutes, doubling to 6 hours) and marked it degraded in `source_health`.

1. Do not retry by hand and do not raise the tier to `captcha` for a court or notice source without counsel's clearance (D-048).
2. Check the source's terms and the request rate (`rate_limit_per_minute`); lower it if the block is a 429.
3. The backoff lifts and the alert resolves after a clean evaluation once the window ends.

## Parse-yield drop

The latest parse run yielded less than `slo_parse_yield_floor` of the expected records, usually a layout change. The parser version is quarantined into the review queue (`source_health.quarantined_parser_version`).

1. Fetch a current page through the governed fetcher and compare it with the adapter fixtures.
2. Fix the parser, ship a new parser version and let one parse run clear the floor; the quarantine is released then.

## Cost anomaly

The last 24 hours cost more than three times the 7-day daily baseline, and more than $0.50.

1. Group the day's `fetch_log` rows by tier: a jump to `proxy` or `captcha` is the usual cause.
2. Check for a retry loop or a new schedule on the source; lower `max_cost_dollars` or `max_tier` on the source row if needed.

## Conflict-rate spike

More than 10% of the records parsed in the last 24 hours conflicted with existing records.

1. Sample the conflicting records for the source in the review queue.
2. A systematic conflict means the parser is reading a field wrongly: treat it as a [parse-yield drop](#parse-yield-drop). A source that really changed its data needs the adapter updated.
