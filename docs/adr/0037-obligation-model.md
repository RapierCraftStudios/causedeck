# 0037. The obligation model: names, reschedule versus miss, no rule-derived dates

## Status

Proposed

## Date

2026-10-25

## Context

The obligation service (#67) tracks what a court or a person requires an advocate to do by a date: orders' directions, registry defects, certified copies and plain tasks. The `obligation` table, its enums and its closure check already exist and `timeline` and `merge-split` read them. The issue uses other words (`closed`, `completed_task`, `kind`).

## Decision drivers

- Existing readers must not break.
- Closing is a person's act, with a reason.
- A date that moves on purpose must not look like a miss.
- A deadline is only as good as its source; a generated legal rule is not a source (limitation dates are #84, behind a flag).

## Considered options

| Option                                                         | Verdict  | Reason                                                             |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| Keep the stored names and map the issue's terms here           | Chosen   | No migration of existing columns; `timeline` and `merge-split` hold |
| Rename the enums to the issue's terms                          | Rejected | Breaks existing readers and tests for no behaviour                  |
| Derive due dates from limitation or procedure rules            | Rejected | A wrong generated date is worse than none; belongs to #84           |

## Decision

- Names: the issue's `closed` is status `done` (or `not_applicable`), `completed_task` is `task_completed`, `kind` is the column `source`. `obligation_closure_chk` and the service guard hold the closure rule.
- New tenant tables `obligation_event` (history), `defect` and `certified_copy`, each with `workspace_id`, composite foreign keys and FORCE RLS; children cascade with their obligation.
- A reschedule needs a reason and writes a `rescheduled` event with the old and new date. `missedObligations` counts an obligation whose current date passed while it was open as a miss and counts deliberate reschedules apart.
- Due dates come from a person or an anchored document; `createObligation` refuses source `rule`. `due.ts` only moves calendar days (IST, a working-day hook that skips Sundays).
- Defects and re-presentation move the proceeding through `transitionProceeding`; SR and FR numbers are stored on the proceeding and say nothing about court status.
- A confirmed `obligation_from_direction` proposal is created through the same guards; an undated direction needs a date before it can be confirmed.
- Reminders: `system.obligation.reminders` at 07:00 IST enqueues `obligation.reminders` per workspace, one in-app notice per member per local day (counts and a link only, default lead time two days).

## Consequences

- Clerk-level writes (`obligation.track`) cover tasks, defects and copies; other sources need `obligation.write`.
- Strategy-bearing descriptions hidden from clerks (a column-scoped view) are not delivered: the table has no strategy flag yet.

## Revisit when

- Members need their own reminder lead time.
- A strategy-note flag exists on obligations.
