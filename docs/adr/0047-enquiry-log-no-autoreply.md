# 0047. Enquiry log with no auto-reply

## Status

Proposed

## Date

2026-10-26

## Context

PRD intake (#87) lets a chamber log an inbound enquiry (a person asking it to take work), check the names on it against the chamber's own matters for a conflict of interest, and accept it as a matter, decline it, refer it or close it. An enquiry holds a prospective client's name, phone, email and a summary of their problem. Replying to a prospective client, soliciting work or accepting an engagement on an advocate's behalf touches Bar Council of India advertising and solicitation rules, so the legal-gated flag `intake.enquiry_log` keeps the feature dark until counsel clears it (#117).

## Decision drivers

- Nothing may reach a prospective client unless an advocate sends it outside CauseDeck.
- The conflict check informs; the advocate decides.
- Accepting an enquiry must follow the same path as every other matter creation.
- Prospective clients' details are not kept for ever.

## Considered options

| Option                                                           | Verdict  | Reason                                                                           |
| ---------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Log only; no reply, template or notification; hits, not verdicts | Chosen   | No outbound surface to clear; the advocate keeps the judgement                   |
| Acknowledge receipt automatically                                | Rejected | An automatic message to a prospective client is solicitation-adjacent            |
| Return a "conflicted / clear" verdict                            | Rejected | A name match is not a conflict finding; a false "clear" would be worse than none |
| Create the matter directly on accept                             | Rejected | Bypasses the automation engine; a new matter defines identity and is a proposal  |

## Decision

The intake domain (`@causedeck/core/intake`) logs enquiries in the tenant tables `enquiry`, `enquiry_party` and `conflict_check_result` under FORCE row-level security. Every service first reads the `intake.enquiry_log` flag and refuses with `FeatureDisabledError` while it is off, then checks `enquiry.read` or `enquiry.write` (owner and advocate only). The domain sends nothing: it imports no email, WhatsApp or notification code, and a static test fails the build if it does. `runConflictCheck` wraps `checkConflicts` and returns ranked hits (matter, the chamber's role there, a reason), never a verdict. `acceptEnquiry` submits a `new_matter` proposal through `submitProposals`, so the advocate still confirms the matter, and the enquiry only records the proposal. A closed enquiry is deleted by the daily `system.enquiry.retention` job after the workspace's `enquiry_retention_months` (default 12, 1 to 120). Audit events hold ids and counts, never names or text.

## Consequences

- Positive: no outbound path to review; a prospective client's details expire; matter creation keeps one path.
- Negative: an advocate replies to the enquirer by hand, outside the product.
- Neutral: the web screens (#874) and their stories and e2e specs (#875) follow.

## Revisit when

Counsel clears an acknowledgement message (#117), or the retention window needs to differ by channel.
