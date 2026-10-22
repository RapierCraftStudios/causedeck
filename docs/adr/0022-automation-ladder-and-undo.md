# 0022. Automation ladder, proposals and undo cascades

## Status

Proposed

## Date

2026-10-22

## Context

Every source in the product (documents, voice, calendar, email, lists) produces suggested changes to the matter graph. The product promise is that the system helps without ever acting for the lawyer: it never sends, files, pays, advises, accepts an engagement or inserts a citation (PRD TR-1, TR-2, TR-4; [ADR 0010](0010-feature-flags-db-backed-legal-gating-and-no-l5.md)). The [technical architecture spike](../engineering/13-technical-architecture-spike.md) §5 puts the rule in one place, the automation engine, and docs/product/09 §4 gives the ladder (L1 to L4), the approval-boundary matrix, the 7-day undo and the failure recovery (a wrong match undoes in a cascade, a duplicate merges with undo, an undo makes that kind of action harder to auto-apply, a person can ask to be asked first). This ADR records how the engine (#47) is built.

## Decision drivers

- The guardrail is structural: a fifth level or a send path must be impossible to add by accident, and CI must say so.
- Date-critical, financial and identity-defining changes are always proposals; a confirmed next date is never overwritten ([ADR 0016](0016-proceeding-state-machine-and-next-date-rules.md)).
- Everything the system did on its own can be reversed for 7 days, with what depends on it.
- Sources do not decide levels: they hand over drafts, and one function decides.
- No draft is dropped silently; a draft the engine cannot trust is a card for the person.
- The graph keeps one writer per concern: handlers go through the matter-graph services where one exists.

## Considered options

| Option                                                                       | Verdict  | Reason                                                                                                          |
| ---------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| One `decideLevel` over an approval matrix kept as data, one handler per kind | Chosen   | The matrix is testable as a table; adding a kind means adding a row and a handler, both checked by CI           |
| Let each source set its own level on its drafts                              | Rejected | A source could raise its own trust; the boundary would be spread over every caller                              |
| A level column with free text and a code-only guard                          | Rejected | The database would accept a fifth level; the CHECK on `proposal.level` and `activity.level` makes it impossible |
| Undo by a global "revert" of the whole capture only                          | Rejected | A person must be able to undo one action and what grew from it without losing the rest                          |
| Undo cascades through `parent_activity_id` and `cascade_group_id`            | Chosen   | The root of a capture (the document attach) carries its derived activities; undoing it takes them with it       |
| Learn thresholds with a model                                                | Rejected | No training on customer data; a fixed step (+0.02 per undo, cap 0.99) is explainable                            |

## Decision

- **Ladder.** `AutomationLevel` is `'L1' | 'L2' | 'L3' | 'L4'`. L2 proposes and changes nothing until a person accepts; L3 applies an internal, reversible change and logs an `activity` with a 7-day undo; L4 prepares an outward draft that only a lawyer sends (outward drafting is #69; the engine has no send path). `proposal.level` and `activity.level` carry a CHECK to the same set. `ai_call.automation_level` keeps its numeric 1 to 4.
- **Static guard.** `scripts/check-no-l5.ts` (`pnpm check:no-l5`, a CI lint step) fails when a fifth level appears in the code of any package or app source file, when the proposal-kind registry holds a kind that sends, files, pays, advises, accepts an engagement or inserts or generates a citation, when a handler is registered for a kind outside the registry, or when an automation module imports `notifications` or an outward transport.
- **Matrix.** `APPROVAL_MATRIX` lists each kind with its default level, an optional L3 gate and a base threshold. `decideLevel(draft, ctx)` reads it, then lowers an L3 result to L2 for a draft that is low-confidence, unanchored (AI without an anchor) or ambiguous, below its learned threshold, or for a kind the user asked to be asked first. It never raises a level. A next date, a compliance or limitation date, a new matter, a new proceeding, an order, a fee entry and a memory item are always L2. Attaching a document needs an exact case-number or CNR match at score 0.9 or more; an item number, courtroom or bench from a list needs an exact case-number match; an undated task needs confidence 0.8; a phone or email on a known party and a duplicate capture may be applied unasked. Client, senior and third-party messages are L4.
- **Submit.** `submitProposals` validates each draft with `ProposalDraftSchema`, gives every draft a result, and in one transaction applies the L3 ones (each in a savepoint, so a failed apply becomes a card, not a lost draft) and stores the rest as `proposed`. The idempotency key is sha256 of kind, payload and capture; a dismissed or already stored draft is never proposed again. A draft from an AI call about a sensitive matter is refused and stored nowhere. Proposals about sensitive matters are left out of digests that leave the workspace.
- **Next date.** The `next_date` handler stages the proposed date at submit time with `proposeNextDate` (a proposal, or a conflict that keeps both sources, or nothing to do) and calls `confirmNextDate` only when a person accepts. The kind is never L3.
- **Handlers.** One per kind (`validate`, `apply`, `undo`), registered in a registry that rejects unknown and forbidden kinds. They write through the matter-graph services (`createMatter`, `createProceeding`, `upsertPerson`, `proposeNextDate`, `confirmNextDate`) and, for tables with no service yet (task, obligation, order, a listing's item number, hall and bench, a document's matter), through typed writes of their own that never touch `listing.list_date` or `canonical`. `memory_item` and `fee_entry` are registered as `KindNotEnabled` until #72 and #83; `outward_draft` until #69.
- **Undo.** An activity records its `undo_payload`, `undo_expires_at` (created plus 7 days), who confirmed it, `parent_activity_id` and `cascade_group_id`. `undoActivity` reverses it and every activity derived from it in the cascade group, deepest first; `previewUndo` lists what will go. After 7 days it throws `UndoExpiredError`; for a result the lawyer confirmed or edited it throws `UndoRefusedError`. `undoCapture` undoes everything auto-applied from one capture; `reassignCapture` moves its documents, tasks and obligations to another matter and marks them `corrected`.
- **Learning.** Each undo raises the threshold of its `(kind, pattern_key)` by 0.02 (cap 0.99) in `automation_threshold`. `automation_preference(kind, ask_first)` lowers any L3 to L2 for that user.
- **Audit.** Every submit, apply, accept, dismiss, expire, undo and reassign writes an `audit_event` (ids, kind, level and counts only). An activity names the model, version and region of the `ai_call` behind it, read from that row.

## Consequences

- Positive: one place decides what the system may do; the guardrail is enforced by the type, the database and CI; an undo is cheap and explainable.
- Positive: adding a kind is a matrix row, a handler and a registry entry, each covered by a guard test.
- Negative: handlers for tables without a matter-graph service write them directly until those services exist; each such write is covered by an undo round-trip test.
- Negative: an undo cannot restore a first-ever next date to "none", because the matter-graph has no service that clears a canonical date; such an activity is never L3 anyway, so this is theoretical.
- Negative: `capture_id` is a plain uuid until the capture table (#43) exists.

## Revisit when

- #43 adds the capture table (add the foreign key).
- #72 or #83 enables the memory or fee handler.
- The v1 experiment of corroborated auto-confirm starts (not built here, off by default).
- A source needs a kind that does not fit the matrix.

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- [ADR 0010](0010-feature-flags-db-backed-legal-gating-and-no-l5.md)
- [ADR 0016](0016-proceeding-state-machine-and-next-date-rules.md)
- [Core domains](../engineering/core-domains.md)
