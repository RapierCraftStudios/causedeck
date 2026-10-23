# 0026. WhatsApp import: parse in the browser, upload the selection

## Status

Proposed

## Date

2026-10-23

## Context

PRD CA-6 lets a lawyer bring an internal WhatsApp chat (chambers, juniors, clerks, co-counsel) into the capture inbox. Client conversations stay out for now, and a chat export holds identity numbers, bank details and passwords that must never be stored. Parts 1 and 2 of #55 built the isomorphic parser and exclusion rules (#525) and the server intake, structuring and upload route (#526, [ADR 0021](0021-capture-inbox-and-upload-pipeline.md)). This ADR records how part 3 (#527), the import UI, is built. The issue called it ADR 0024; 0024 and 0025 were taken on the base, so it is 0026.

## Decision drivers

- A client chat, an unselected message and a held-back message must never leave the browser.
- The server must not trust the browser: the rules and limits are applied again on upload (#526).
- A 10,000-message export previews in under 2 s with no main-thread long task over 50 ms.
- No new server surface: the flow uses the existing capture route and permission model.

## Considered options

| Option                                                      | Verdict  | Reason                                                                                                   |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Unzip, parse and flag in a Web Worker, upload the selection | Chosen   | The raw file and held text stay on the device; the main thread only renders                              |
| Upload the zip and parse on the server                      | Rejected | Client chats and PII would leave the device before the user chose anything                               |
| Parse on the main thread                                    | Rejected | 10,000 messages block input for far longer than 50 ms                                                    |
| `fflate` for the zip                                        | Chosen   | Small, no dependencies, synchronous inflate suits a worker, already in the lockfile transitively (0.8.3) |
| `JSZip` or the browser `DecompressionStream`                | Rejected | Heavier, or cannot read a multi-file zip directory                                                       |
| `@tanstack/react-virtual` for the list                      | Chosen   | Already an `apps/web` dependency; only rows in view are in the DOM                                       |

## Decision

- **Route**: `/w/[slug]/inbox/import/whatsapp`. It is a 404 while `capture.whatsapp-import` is off, has no navigation entry, and is for owners and advocates (`workspace.manage`); other members get permission-denied. The server still requires `document.write` on upload.
- **Chat type first**: internal continues. A client conversation, or not sure, stops with "Client conversations stay out of CauseDeck imports for now" before any file is read. After parsing, heuristics (client-looking participants such as honorifics, `client` or bare phone numbers; two people neither of whom is the member) stop the import or ask to confirm it is internal.
- **Worker**: `apps/web/workers/whatsapp-parse.worker.ts` reads the zip with `fflate` (text entries only, 5 MB text cap), parses with `@causedeck/capture/whatsapp` (never the package root) and flags the exclusion rules per message. The chat title is hashed (SHA-256) and only the hash is uploaded.
- **Selection**: messages tripping a rule start held back; a releasable one is included only after a per-message confirm and sent with its id in `confirmedIds`; Aadhaar and credential matches can never be released. At most 5,000 messages are selectable.
- **Upload**: one JSON `POST /api/captures/whatsapp` with the selected messages only. A test asserts the payload shape.
- **Disclosure** names what happens to the chat, per channel: parsed here, selection only, held-back rules, voice notes kept as files, no contacts or notifications, 30-day text retention.
- **Budget**: parse and flag in the worker; list virtualised; `@perf` e2e checks 10,000 messages and long tasks.

## Consequences

- Positive: a client chat or PII never reaches the server by this route; the server's own rules remain the authority.
- Negative: the heuristics are crude (they over-stop rather than under-stop); results of a large parse cross to the main thread in one message.
- Follow-ups: a legal-counsel unlock of the flag (#120) before production use.

## Revisit when

- Counsel allows client conversations (#120), which would replace the stop step.
- Real exports exceed 10,000 messages or the cross-thread copy shows up as a long task.

## Links

- [ADR 0021](0021-capture-inbox-and-upload-pipeline.md)
- [Feature flags and legal gating](0010-feature-flags-db-backed-legal-gating-and-no-l5.md)
