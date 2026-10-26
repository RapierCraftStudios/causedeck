# 0037. The court day read model

## Status

Proposed

## Date

2026-10-24

## Context

A lawyer needs one view of a day's listings across complexes and halls, clashes between them, what changed between a daily and a supplementary list, and a manual note of where a hall has reached (#58). The next date of a proceeding already has one canonical source (matter-graph). Fetching lists is not this feature's job.

## Decision drivers

- One canonical next date per proceeding; never overwritten automatically.
- No predicted time overlap may be implied.
- Strategy-bearing fields stay out of the clerk payload; sensitive matters expose no AI-derived fields.

## Considered options

| Option                                                | Verdict  | Reason                                             |
| ----------------------------------------------------- | -------- | -------------------------------------------------- |
| Read model in `court-day` over existing tables        | Chosen   | No change to listing, hearing or appearance tables |
| A second next-date store in `court-day`               | Rejected | Two sources of truth                               |
| Predict when each item is called to flag time clashes | Rejected | A promise the data cannot keep (D-050)             |

## Decision

- `getCourtDay` returns items grouped complex, hall, list type and item, scoped `mine` or `workspace`; `workspace` needs the `court_day.view_all` action (owner, advocate unless the workspace turns it off).
- `detectClashes` states a fact only: same date, different hall or complex.
- Two new tenant tables: `list_snapshot` (immutable, hash and rows) and `court_day_marker` (the manual hall marker, audited). Lists are lawyer-supplied or forwarded; core never fetches.
- Next date wraps matter-graph `proposeNextDate`; it never edits it.

## Consequences

- `court-day` now depends on `matter-graph`, `workspaces` and `audit`.

## Revisit when

- A list source is cleared for automatic ingestion.
