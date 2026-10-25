# 0039. Outward update drafts: L4 only, no send path

## Status

Proposed

## Date

2026-10-25

## Context

Lawyers owe clients and senior or briefing counsel short updates after a hearing or an order (#69, backend in #735). A draft written by the system and sent by the system would put the firm's words in front of a third party without a lawyer reading them. The product's automation ladder keeps outward communication at L4: the system prepares, a person approves and acts.

## Decision drivers

- A lawyer reads and owns every outward word.
- A wrong or advisory sentence in a client message is a professional risk.
- A sensitive matter must not reach a model at all.
- Nothing in the code should be able to transmit a message by itself.

## Considered options

| Option                                                          | Verdict  | Reason                                                           |
| --------------------------------------------------------------- | -------- | ---------------------------------------------------------------- |
| Prepare a draft; the lawyer shares it from their own channel    | Chosen   | Keeps the lawyer as the sender; nothing to authorise or revoke   |
| Send through WhatsApp or email on the lawyer's approval         | Rejected | Needs a transport, consent and delivery handling; not L4 minimum |
| Auto-send routine updates                                       | Rejected | Removes the person from the loop                                 |

## Decision

- Tables `outward_draft`, `outward_draft_version` and `outward_share_log` are tenant tables under FORCE RLS. Drafts are for a client (an existing `person` of kind `client`), senior counsel or briefing counsel; no other third party.
- Facts come from confirmed hearing, order and obligation rows with their provenance. An unconfirmed fact becomes a flagged "to be confirmed" line, never a plain statement.
- The text is built from per-language fact templates (English, Tamil, Kannada) and tones (formal, brief, warm). The `outward_update` task (drafting tier, India-only residency through the gateway) only adds an opening and a closing block around the fact lines.
- A sensitive matter is template-only: no model call. A gateway failure (residency, budget, provider) also falls back to the template.
- `guardOutward` removes sentences that give advice, make commitments, state fee terms, predict an outcome or cite an authority, in the three languages. Blocks that are stripped are replaced by the template frame.
- Every edit is a new version with a word diff against the previous one. Sharing is an explicit member action: `recordShared` and `recordCopied` write the share log with the channel (clipboard, a user-initiated WhatsApp or mailto link, or a download) and the final version, and emit `outward.shared`.
- There is no transport: the domain imports no mail, WhatsApp or queue code and registers no job. A static test scans for it. The existing `draft.write` action gates every call.

## Consequences

- A lawyer must act to share; there is no reminder or auto-share job.
- The log records the lawyer's share, not whether the recipient got it.
- Language preference and relationship memory are not read yet (#72, #82); the language defaults to English.

## Revisit when

- Preferred language and tone are stored per client.
- The web editor (#736) needs list and read services.
