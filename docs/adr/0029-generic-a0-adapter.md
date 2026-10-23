# 0029. A0 generic adapter: skeleton first, anchored model pass, always L2

## Status

Proposed

## Date

2026-10-23

## Context

Issue #56 builds the A0 tier of the adapter ladder for forums with no dedicated adapter: the Bengaluru urban and Chennai district courts (`in.ka.bengaluru-urban.district`, `in.tn.chennai.district`) and a catch-all (`generic.a0`). District orders are Tamil-first in Chennai and increasingly Kannada in Bengaluru, case numbers stay English, and the district cause-list pages sit behind two verification challenges and carry no advocate field (research/raw/09 §2.1). [ADR 0015](0015-court-adapter-framework.md) is the framework it registers into, [ADR 0028](0028-anchored-extraction.md) owns the anchor and date rules it reuses, [ADR 0022](0022-ai-gateway-implementation.md) the gateway, and [ADR 0023](0023-automation-ladder-and-undo.md) the proposal contract and the approval matrix.

## Decision drivers

- A0 makes the OS work everywhere at lower trust: every output is a proposal the lawyer confirms, never applied unasked.
- The code decides what survives, as in #46: a row needs a verbatim quote on its page, the case number inside the quote, and every date written in the quote.
- Sensitive matters and `ai_blocked` captures never reach the gateway.
- No scraping or verification-challenge handling: the product reads only what the lawyer shares.
- `ProposalDraft` and the approval matrix are not ours to change.

## Considered options

| Option                                                                                                  | Verdict  | Reason                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Model-only parse of lists and orders                                                                    | Rejected | Nothing works without a model or inside its budget, and a confident wrong row is the failure we cannot afford                             |
| Deterministic skeleton, then a model pass the validators check                                          | Chosen   | The skeleton is the hint set and the fallback; the model only adds what it can quote                                                      |
| Copy the anchor and date code into `adapters`                                                           | Rejected | Two implementations of "a date is real only if it is written in the text" drift; #46's modules are pure                                   |
| Reuse `@causedeck/intelligence/extract` and `/language`                                                 | Chosen   | Two subpath exports keep mupdf and sharp out of the `adapters` entry that `apps/web` imports; both are type-only on `ai`                  |
| Add `proposedLevel` to `ProposalDraft`                                                                  | Rejected | The schema is strict and ADR 0028 rejected it; the engine routes by kind and `match.exact`                                                |
| Level beside the draft; never set `match.exact`; never emit `task`, `party_detail` or `document_attach` | Chosen   | The kinds and gates that can reach L3 unasked are never produced, so A0 is L2 by construction, including exact case-number matches        |
| Persist corrections in this change                                                                      | Deferred | Needs a `corrections` table (RLS catalog, seeders) and a `workspace_settings.allow_eval_reuse` column; the model, gate and port ship here |

## Decision

- **Skeleton** (`skeleton.ts`, `patterns.ts`): case references from the union of every registered adapter's nomenclature and the district types (`Com.O.S.`, `Com.Ex.`, `Com.A.P.`, `Com.A.A.`, `Com.Misc.`, `Com.FDP`, `O.S.`, `Crl.Misc.`, `Ex.P.`, `CCCA`), CNRs (`^[A-Z]{4}\d{2}\d{6}\d{4}$`), date literals in English, Tamil and Kannada digits, hall and stage headings, and table rows from the layout. Every candidate is anchored to its line.
- **Model pass** (`llm-parse.ts`): gateway tasks `parse_list_a0` (v2, anchored rows) and `parse_order_a0`, at most one call per 12 pages and two per document, each inside a 25 s budget; the skeleton goes in as hints. An `ai_blocked` capture or sensitive matter passes no gateway, so no `ai_call` row exists; budget exhaustion, a timeout or a provider failure falls back to the skeleton.
- **Validators** (`validate.ts`): a row survives only if its quote is on its page and contains the claimed case number; a CNR only if it has the 16-character structure and is in the quote; a date only if `datePresence` finds it in the quote; relative dates only by code (`validateExtraction`, #46). Everything else is listed in `rejected[]` with its reason. Instruction-like text routes the document to Needs you and demotes its dates.
- **Trust**: skeleton rows claim at most 0.6, a model-only row 0.7, a corroborated row 0.8, and nothing above 0.85 until the person confirms a row of the same list (then 0.95, for display only).
- **Identity**: the CNR when present, else forum plus normalised case type, number and year; types no official source confirms are `verified: false`. District lists carry no advocate; rows are proposed only when they match a workspace CNR, case number or party alias, and the rest go back to the caller for discard.
- **Language**: Tamil and Kannada documents keep their script, rows and documents carry language tags, party names keep the original script with spelling-tolerant aliases, and OCR is hinted with the forum language profile. Nothing is machine-translated or transliterated.
- **Proposals** (`to-proposals.ts`): `{ proposedLevel: 'L2', draft }`. Orders reuse `toProposalDrafts` and drop `task` drafts.
- **Registry**: the three ids are registered with `cause_list` and `orders` `user_supplied`, `status` and `display_board` `none`, no deep link (migration 0061); the district forums stay at adapter level A0.

## Consequences

- Positive: the OS works in every forum from day one with no way to apply an A0 result unasked; the same anchor and date rules protect lists and orders.
- Negative: precision on real district documents is unmeasured until #119; the skeleton misses types outside the known set (flagged `unknown_case_type`, never dropped); Tamil and Kannada order dates come from the model path only, because the #46 pre-parse cues are English.
- Follow-ups: the `corrections` table and `workspace_settings.allow_eval_reuse`; real district fixtures (#119); the confirmation UIs (#48, #57) and matching (#47).

## Revisit when

- Real district fixtures (#119) show row precision under 98% or any hallucinated date.
- The engine's matrix changes which kinds can reach L3.
- A district site publishes a machine-readable feed the lawyer may use.
