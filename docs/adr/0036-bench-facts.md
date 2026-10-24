# 0036. Internal bench facts and the flagged bench card

## Status

Proposed

## Date

2026-10-24

## Context

Call-time estimates, roster reconciliation and coverage need neutral per-hall, per-day counts and pace, and a matter's page may one day show a factual bench card (#521, D-050). D-050 prohibits ratings, rankings, comparisons between judges, outcome rates, predictions and sentiment at any stage. Only the owner, app and clerk database roles exist, and the worker and the web both connect as the app role.

## Decision drivers

- Internal data must be unreachable from user-facing code paths.
- No new database role or credential for one table.
- Judge-level output stays behind a legal gate (#118).
- The prohibited content must be caught by a test, not by review.

## Considered options

| Option                                                      | Verdict  | Reason                                                           |
| ----------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| REVOKE all grants plus owner-defined SECURITY DEFINER reads | Chosen   | Precedent in 0033, 0072 and 0076; no new role                    |
| A worker or internal role with its own grants               | Rejected | Needs infra and credentials; the worker connects as the app role |
| Grant the app role SELECT on the table                      | Rejected | Any app-role query could read it                                 |

## Decision

- `bench_sitting_fact` is global (source, hall, sitting date; counts and minutes per item; nullable bench). The app and clerk roles have no table grant; `app_bench_fact_record`, `app_bench_pace`, `app_bench_card` and `app_bench_for_halls` (ids only, over active roster entries) are the only access.
- `packages/intelligence/src/bench-facts` aggregates board observations into the facts; `pollBoards` refreshes them and never fails a poll on them. `getLiveHalls` tops thin per-hall samples up with the stored pace.
- The user-facing bench card (`getBenchCard`, `GET /v1/workspaces/{id}/matters/{id}/bench-card`) sits behind the legal-gated flag `bench_facts` (kill switch `KILL_BENCH_FACTS`), off by default; off returns null or 404.
- A static test fails on any rating, ranking, comparison, outcome-rate, prediction or sentiment field or string in the bench-facts code.

## Consequences

- The flag key `bench_facts` is the one underscore key; the flags docs test accepts it.
- No web rendering of the card yet.

## Revisit when

- Counsel clears the bench card (#118) and the web surface is built.
- A real worker role exists and the definer functions can narrow.
