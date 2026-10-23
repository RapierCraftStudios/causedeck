# 0030. Email forward-in: inbound webhook, providers and the `email.intake` job

## Status

Proposed

## Date

2026-10-23

## Context

#54 lets a lawyer forward court and registry email to a private address. Part 1 (#528) built the pure parser registry, sender trust and the AIMS parsers in `@causedeck/capture`; part 2 (#529) built the per-user address, the allow-list and the settings page. This ADR records part 3 (#530), which wires them together: the inbound webhook, the providers, the `email.intake` job and raw-MIME retention. The issue called it ADR 0024; 0024 to 0027 were taken on the base, so it is 0028.

## Decision drivers

- Email is untrusted input: a message from an unknown sender must never reach a parser or a model.
- The webhook must answer in under 300 ms and must not become an oracle for which addresses exist.
- A provider may deliver the same message twice; a message must be processed once.
- Real SES credentials and the inbound route are a human task (#110); everything else must run in dev and CI without them.

## Considered options

| Option                                | Verdict  | Reason                                                                                              |
| ------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| Parse in the webhook                  | Rejected | Fetching raw mail from S3 and parsing MIME does not fit a 300 ms budget and makes a retry re-parse. |
| Record in the webhook, parse in a job | Chosen   | Same shape as the Razorpay webhook: verify, record once, enqueue in one transaction.                |
| Provider-specific code in the API     | Rejected | The API would import SES details. A provider seam keeps SES, file and Mailpit behind one interface. |

## Decision

1. `InboundEmailProvider` (`packages/capture/src/email/provider.ts`) verifies a request and returns notifications (message id, recipients, raw reference); `fetchRaw` reads the raw message; `discardRaw` deletes it. `ses` verifies the SNS signature (versions 1 and 2, certificate URL pinned to `sns.<region>.amazonaws.com`, optional topic allow-list) with `node:crypto` and takes the S3 reader and certificate fetch as injected functions, so no AWS dependency is added and tests use fakes. `file` and `mailpit` authenticate with a shared-secret header. `INBOUND_EMAIL_PROVIDER` selects one; none means every call is a 400.
2. `POST /v1/inbound/email` is public, verifies through the provider, resolves each recipient with `resolveAddress` (no oracle), and calls `receiveInboundEmail`, which stores the message once per `(workspace, message id)` with `raw_expires_at = received + 30 days` and queues `email.intake` (ids only) in the same transaction. Unknown addresses and a disabled `email` channel return 200 and log only the dropped reason.
3. `email.intake` (`runEmailIntake`) works only a `received` message, so a retry or a second delivery is a no-op. It reads the raw message, builds the allow-list and the known matters, and calls `processIntake`. Auto-replies are dropped. An unknown or failing sender is quarantined: the message is `quarantined` and an `email` capture in `needs_you` with `source_meta.needsYouReason` carries the "Unrecognised sender: review" card; no parser and no AI run. Otherwise the body text and allowed attachments are stored as captures (attachments go through the scan hook and `capture.process`), drafts go to `submitProposals` linked to the body capture, and the message is `processed`. Captures that name a sensitive matter are `ai_blocked`, so no AI step runs on them (CA-10).
4. Failures retry five times with backoff, then reach the dead-letter queue like every job.
5. Raw MIME lives 30 days unless pinned. `email.intake` schedules a delayed `email.raw-expire` for the expiry; it asks the provider to delete the source object and clears `raw_mime_ref`. The extracted text, captures and proposals stay.

## Consequences

- Production SES needs the S3 reader and certificate fetch wired in once #110 supplies credentials; until then `ses` yields no provider.
- The lawyer's enrolment numbers and aliases have no stored source yet, so the parsers' "own unmatched rows" path stays empty until they do; exact case-number and CNR matches work today.
- A message pinned after its delayed job ran is not re-scheduled; unpinning does not delete the raw object.

## Revisit when

- #110 supplies SES credentials and the S3 reader, or the heuristics for sender trust prove too strict.
- Pinned messages need their raw MIME expiry re-scheduled on unpin.
