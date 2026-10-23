# 0028. Voice capture: transcribe, structure with spans, and validate every spoken date

## Status

Proposed

## Date

2026-10-23

## Context

Issue #51 (split into #541, #542, #543) lets a lawyer dictate what happened at a hearing and turns it into proposals. [ADR 0022](0022-ai-gateway-implementation.md) routes every model call through the gateway; [ADR 0023](0023-automation-ladder-and-undo.md) gives the proposal kinds and the approval matrix. This ADR covers the library part in `packages/intelligence` (#541): transcription, structuring, the spoken-date parser and the drafts. The worker job, the sensitive-matter guard and recording deletion are #542; the recorder UI is #543. Guardrails: no L5, no generated or unverified citations, India-only AI, sensitive matters never go to AI, no training on customer data.

## Decision drivers

- A date is date-critical (PRD TR-1): a wrong next date is worse than none.
- A model may be wrong, and the transcript may contain speech that tries to instruct the system.
- Dates are spoken in English, Tamil and Kannada, often mixed in one sentence.

## Considered options

| Option                                                                            | Verdict  | Reason                                                                                              |
| --------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| Let the model return the next date and trust it                                   | Rejected | A model can invent a date that sounds right; nothing ties it to what was said                       |
| The model only points at a phrase; a deterministic parser reads the date          | Chosen   | The date exists only if the parser can derive it from the quoted phrase; nothing else is accepted   |
| Reuse the gateway `structure_hearing` output of `hearingProposal` (no spans)      | Rejected | Cannot show where a field came from and cannot be validated against the transcript                  |
| Replace the `structure_hearing` output with spanned fields; add `segments` to STT | Chosen   | `structure_hearing` had no other consumer; `segments` is optional so the Sarvam mapping stays valid |
| Register `hearing_outcome` with a real handler now                                | Rejected | The `hearing` table holds no outcome columns yet; applying belongs with the worker job (#542)       |
| Register `hearing_outcome` as a kind with a disabled handler                      | Chosen   | Drafts exist as "Needs you" cards; `KindNotEnabled` until #542 (same as `memory_item`, ADR 0023)    |

## Decision

- **Transcription**: gateway task `transcribe` with language hints (profile languages, then the forum's). The result keeps segments with `startMs`/`endMs`, a language tag and the character range each covers in the transcript text. A provider without segments yields one segment over the recording. The mock provider reads a `<file>.transcript.json` sidecar.
- **Structuring**: gateway task `structure_hearing` returns `matterRef?`, `outcome`, `adjournmentReason?`, `nextDate? {date, phrase, span}`, `stageAfter?`, `directions[{text, dueExpression?, span}]`, `tasks[{title, span}]`. The transcript is sent as data only. Every field must carry a span inside the transcript; a field without one is moved to `rejected[]` with a reason.
- **Dates**: `nextDate` is accepted only if the quoted phrase equals the transcript text at the span, the parser reads that phrase (whole) to a date, the model's date, if given, equals it, and the date is after the hearing date. The accepted date is always the parser's. `dueExpression` follows the same rule; a direction whose expression fails stays undated. If the next date was dropped, the capture goes to Needs you.
- **Parser conventions**: a date without a year is the first such date strictly after the hearing date; "on the 14th" is the first 14th after it; "next Tuesday" is the first Tuesday strictly after it; "after N weeks" is the hearing date plus 7N days; "after N months" keeps the day of month, clamped to the month's last day. A bare number is never a date: a bare day needs "on the", a date word (`தேதி`, `ತಾರೀಖು`) or an ordinal with digits. Tamil and Kannada ordinals are derived from the cardinals (`-ஆம்`, `-ನೇ`).
- **Prompt injection**: instruction-like speech is detected by pattern; items inside it are rejected, the capture goes to Needs you, and the output never selects a schema, a kind or an action. All output is re-validated here.
- **Matter matching**: candidates from spoken case numbers (normalised with the adapter normalisers), alias-aware party names and an optional listing context. Only an exact case number with an agreeing listing reaches 0.9 (the L3 gate); anything else carries up to three candidates and is `ambiguous`. With no identifier, context or party name there is no candidate.
- **Drafts**: `hearing_outcome` (L2, disabled handler until #542), `next_date` (L2, never applied unasked; a clash with a confirmed date is a conflict card in the engine), `obligation_from_direction` (only for a direction with a parsed date, L2) and `task` (undated; L3 only at confidence >= 0.8 by the matrix). Each carries the anchors of its spans.
- **Eval**: synthetic transcripts only (`fixtures/voice/{en,ta,kn,mixed}`, 48 each, generated by `eval/voice/generate-fixtures.ts`). Gates: next-date accuracy >= 98%, directions recall >= 90%, zero hallucinated dates. The eval uses a cue-word stand-in for the model, so it scores the parser and the validation; real-speech validation with lawyer-recorded samples is a later human gate and does not block merge.

## Consequences

- A voice capture can never put a date in the system that the person did not say.
- `@causedeck/intelligence` depends on `@causedeck/adapters` for the normalisers (adapters does not depend on intelligence).
- Callers of the gateway `structure_hearing` task see a new output shape; there were none.
- Real STT quality, accents and noisy rooms are not measured until recorded samples exist.
