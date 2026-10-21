# 0014. Proceeding state machine and next-date rules

## Status

Proposed

## Date

2026-10-21

## Context

A proceeding in an Indian court moves through a pre-numbering lifecycle before it gets a case number: it is filed, receives SR/FR numbers, may be returned with defects and re-presented, is numbered, and is finally disposed. Sometimes it is reopened (a restoration or review). The schema ([ADR 0013](0013-matter-graph-schema.md), #346) stores only the current `proceeding.state` and `state_changed_at`. The matter graph (#33, spike §5, architecture §2.3) needs one place that decides which moves are legal, keeps the history of the moves for the cross-proceeding timeline (#33 part 5), and hands the registry's cure deadline to the obligation service (#67). This ADR records the state machine (#363, #33 part 2). #33 part 3 appends the next-date rules below.

## Decision drivers

- A state change must never erase what came before: the SR, FR and diary numbers stay after numbering, and every move is kept.
- Services emit events through the `GraphEvents` port and never call the obligation, audit or notification code themselves.
- A state change is a lawyer's (or a confirmed source's) act. An unconfirmed suggestion is a proposal (#47), not a state change.
- Nothing may cross a workspace boundary: another workspace's proceeding is NOT_FOUND.

## Considered options

| Option                                                          | Verdict  | Reason                                                                                                            |
| --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| Transition table in core, append-only `proceeding_state_change` | Chosen   | One writer of `proceeding.state`; the table is testable as a pure function; history serves the timeline and audit |
| Transition rules as a database trigger                          | Rejected | Reasons, actors and cure deadlines would have to reach the trigger through session settings; harder to test       |
| Derive the history from `audit_event`                           | Rejected | Audit attaches to the event port elsewhere and may be filtered; the timeline needs the graph's own record         |

## Decision

States (`proceeding_state`): `filed`, `sr_fr`, `defects`, `re_presented`, `numbered`, `disposed`.

```mermaid
stateDiagram-v2
  [*] --> filed
  filed --> sr_fr
  sr_fr --> defects
  sr_fr --> numbered
  defects --> re_presented
  re_presented --> defects
  re_presented --> numbered
  numbered --> disposed
  disposed --> numbered: reopen (reason required)
```

- `transitionProceeding(deps, actor, { proceedingId, to, reason?, number?, year?, cureDeadline?, provenance? })` in `packages/core/src/matter-graph/state-machine.ts` is the only writer of `proceeding.state`. It allows exactly the eight moves above (`PROCEEDING_TRANSITIONS`). Every other of the 36 ordered pairs, and a reopen without a non-blank reason, throws `InvalidTransitionError` (a `WorkspaceError` with code `CONFLICT`, carrying `from` and `to`). `assertTransition` is the pure form, covered by a fast-check property test.
- Moving to `numbered` (the reopen included) takes `number` and `year` in the same call. They are normalised as on create, and an existing identity is `CONFLICT`. `sr_no`, `fr_no`, `diary_no` and `filing_no` are never written by a transition.
- Entering `defects` may carry the registry's `cureDeadline` (a date). It is stored on the history row and returned in the event payload, so the obligation service can create the cure-deadline obligation. A cure deadline with any other target is VALIDATION.
- Every transition locks the proceeding row, sets `state` and `state_changed_at`, appends one `proceeding_state_change` row (`from_state`, `to_state`, `reason`, `actor_member_id`, `cure_deadline`, `changed_at`, provenance) and emits `proceeding.state_changed` with `{ from, to, reason, actor, provenance }` (plus `cureDeadline` when set and the matter's `sensitive` flag) after the transaction commits.
- `confirmation_state` on the history row comes from the caller's provenance and defaults to `confirmed`. `proposed` is rejected at input: the acting member confirms every state change.
- Access follows the proceeding's matter: `matter.write` to move it, with the role taken from the membership. A proceeding outside the actor's workspace is NOT_FOUND.
- `proceeding_state_change` (migration 0042) is a tenant table under FORCE RLS. Its rows cascade with their proceeding, `actor_member_id` is `ON DELETE SET NULL (actor_member_id)`, and CHECKs mirror the rules (no same-state rows, cure deadline only into `defects`, reopen with a reason). It is exported with the matter graph and purged on workspace erasure.

### Next-date rules

Appended by #33 part 3.

## Consequences

- Positive: one tested place decides proceeding moves; the timeline and audit can read an append-only history; the obligation service reacts to an event instead of being called.
- Positive: SR/FR/diary numbers survive numbering, so a proceeding stays findable by every identifier it ever had.
- Negative: a state imported in bulk (e.g. a migration from another tool) has to replay legal transitions, or be written by a reviewed data migration outside the service.
- Negative: a reopen asks the caller to repeat the number and year it already had.

## Revisit when

- A court's lifecycle needs a state or move outside this table (for example a transfer between forums).
- Automation (#47) needs to propose state changes: proposals then live in #47's store and become state changes here only once confirmed.

## Links

- [ADR 0013: Matter-graph schema](0013-matter-graph-schema.md)
- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- Issues #33, #363, #67, #47
