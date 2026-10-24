# 0028. Anchored order extraction: deterministic first, validator last

## Status

Proposed

## Date

2026-10-23

## Context

Issue #46 extracts bench, order date, case numbers, neutral citation, directions, next date and stage cues from a processed order or judgment (PRD DI-3). Missing or inventing a next date is the worst failure in the product (risk A1; NFR "zero hallucinated dates"). [ADR 0025](0025-document-pipeline.md) emits `document.processed`; [ADR 0022](0022-ai-gateway-implementation.md) routes the model call; [ADR 0023](0023-automation-ladder-and-undo.md) owns `ProposalDraft` and the approval matrix.

## Decision drivers

- The code, not the model, decides what survives: every field needs a verifiable page and verbatim quote.
- A date is real only if it is written in the cited text; a relative date is arithmetic, not reading.
- Sensitive matters and `ai_blocked` captures never reach the gateway, and a slow model never loses a date.
- `ProposalDraft` landed with #47 and must not change; levels belong to the engine's matrix.
- Nothing is dropped silently: rejected and low-confidence results are stored and routed to "Needs you".

## Considered options

| Option                                                             | Verdict  | Reason                                                                                                                   |
| ------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Model returns dates; trust its confidence                          | Rejected | A confident wrong date is the failure mode we cannot afford                                                              |
| Model returns quotes; code verifies quotes and date literals       | Chosen   | A wrong date needs a quote that is on the page and a literal date inside it, which an order either has or lacks          |
| Model computes relative dates                                      | Rejected | Arithmetic belongs to code, with a stated rule the lawyer can read                                                       |
| Relative dates by code from the anchored phrase and the order date | Chosen   | Calendar days, 1 week = 7 days, months by calendar month, no holiday adjustment; always shown with `derivation`          |
| Add `proposedLevel` and inline anchors to `ProposalDraft`          | Rejected | The contract landed with #47 (anchors are `anchor` row ids, levels come from `APPROVAL_MATRIX`); the issue forbids edits |
| Adapt `toProposalDrafts` to the landed contract                    | Chosen   | Anchors are persisted as `anchor` rows first; undated directions become `task` (the only kind with an L3 gate)           |

## Decision

- **Order of work**: regex pre-parse over every page (`extract/preparse.ts`), then at most one gateway call (`extract_order`, `extract_order.v2`) that returns quotes and pages with the pre-parse candidates as hints, then `validateExtraction`.
- **Anchors**: `verifyAnchor` compares NFKC-normalised, whitespace-collapsed text and maps offsets back to the stored page. A quote on the wrong page or invented is `no_anchor`. An opt-in fuzzy mode (Levenshtein up to 3% of the quote) works on OCR pages only and subtracts a fixed 0.15 from confidence.
- **Dates**: `datePresence` accepts an absolute date only if a literal rendering is inside the anchored quote (`dd.mm.yyyy`, `dd/mm/yyyy`, `dd-mm-yyyy`, `12th November, 2026`, `November 12, 2026`, `12.11.26`, Tamil, Kannada and Devanagari digits, English, Tamil and Kannada month names). Numeric dates are day-first. Otherwise `date_not_in_source`.
- **Decoys and conflicts**: dates inside references to earlier orders, impugned orders, statutes and limitation periods, and dates inside instruction-like text, are never next dates. Several candidates, or a model that disagrees with a pre-parse literal, make the extraction `ambiguous`: all candidates are returned and none is chosen.
- **Injection**: instruction-like text marks the extraction `suspicious`; dates are demoted (no chosen next date) and the capture goes to "Needs you". The model has no tools; the output schema is closed.
- **No AI**: for an `ai_blocked` capture or a sensitive matter the gateway is not contacted, so no `ai_call` row exists, and confidence is capped at 0.6 (so every draft is L2). A model that exceeds its 25 s budget gives the same deterministic result, routed to "Needs you".
- **Storage**: `extraction` (tenant table, RLS) keeps the validated result and `rejected[]`. At most one `current` row per `(document, pipeline version)`; re-extraction marks the old row `superseded`. The job `extraction.extract-order` is singleton per document and version.
- **Routing**: a result a person must check moves a `ready` capture to `needs_you` (`ready -> needs_you` is added to the status machine) with a reason code in `source_meta.needsYouReason`.
- **Drafts**: `next_date`, `order_record`, `obligation_from_direction` (when a date is involved), `task` (undated) and `listing_update` (stage cue). `outward_draft` is never produced. The strict `listing_update` payload has no stage field, so the cue travels as the anchored quote and the engine shows the draft as a card.
- **`orderType`** is a classification the model returns (`interim`, `final`, `procedural`), not a quoted fact; it carries no date and is the only unanchored field.

## Consequences

- Positive: a hallucinated date cannot reach a proposal; every kept field can be traced to a page and a quote; the eval gates this in CI.
- Negative: regex cue vocabulary needs maintenance as adapters (#36, #37) add court phrasings; orders that state the next date only in prose without a cue need a model quote and show up as single candidates.
- Follow-ups: real-order validation with lawyer-supplied fixtures (#119, `ADAPTER_PRIVATE_FIXTURES_DIR`); adapter cue sets; the `listing_update` stage field if the engine grows one.

## Revisit when

- The eval on real orders (#119) shows next-date accuracy under 98% or any hallucinated date.
- Adapters supply cue sets that make the pre-parse the primary reader.
- The engine's `listing_update` payload gains a stage field.
