# Court and process analytics (#512, D-049, D-050)

User-facing analytics describe courts and processes, never judges. Code: `packages/intelligence/src/analytics/`; page: `/w/[slug]/courts/insights` (needs `insights.read`).

## Metrics

Each cell is forum x case type x stage x year. A matter's stage is the normalised stage of its first listing (`unlisted` when it has none).

- Median listing delay: days from `proceeding.filing_date` to the matter's first `listing.list_date`.
- Adjournment rate: hearings with an `adjournment_reason` over all hearings (hearing year).
- Median time to disposal: days from `filing_date` to the last `proceeding_state_change` into `disposed`.
- Pending matters: matters with no disposal.

Matter metrics use the filing year; the adjournment rate uses the hearing year. The window filters filing dates and hearing dates.

## Privacy

- Own workspace only: the query runs in the caller's RLS transaction, so no figure mixes another workspace's data. Network-wide aggregates need an owner-defined function and counsel review (D-050) and are not built.
- A metric with fewer than `MIN_CELL_SIZE` (5) observations is withheld (`value` and `n` null); a cell with every metric withheld is not shown.
- No title, party, hall or composition column is read, and no internal sitting store (`bench_sitting_fact`, `board_observation`).

## Guard

`static-guard.test.ts` scans the analytics source, the page, the component and the English strings for judge, composition and party words, and for the internal stores. It has a planted-offender case.

## Not built

Expected timelines on a matter (R10) and institution API endpoints (R6, #487 was closed as not planned) are follow-ups.
