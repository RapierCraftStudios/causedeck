# 0011. Access-mode registry closed enum

## Status

Proposed

## Date

2026-10-19

## Context

Court adapters read cause lists, orders, case status and display boards. How a capability may get that data is a legal question (PRD CL-6, D-040): the product never scrapes court sites without authorisation and never circumvents a captcha. The system architecture ([10 §3](../product/10-lawyer-os-system-architecture.md)) gives each adapter resource an access mode from a short list. The spike lists `access_mode_registry` in [§4.2](../engineering/13-technical-architecture-spike.md#42-core-schema-drizzle-superset-of-10-2) and puts legal-gated capability behind flags in [§9](../engineering/13-technical-architecture-spike.md#9-credentials-and-human-inputs-all-tracked-as-needs-human). Issue #22 enforces the registry in code with `assertAccessMode` in `packages/flags`.

## Decision drivers

- An adapter must not be able to run a capability that counsel has not cleared.
- Nobody can add a mode that permits unauthorised retrieval by accident.
- The rule must be checkable by a machine (types, database enum, CI), not only by review.

## Considered options

| Option                                                | Verdict  | Reason                                                                                 |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| Closed enum in code and Postgres, pinned by a CI test | Chosen   | Adding a mode fails typecheck, the migration grep and the ADR check until reviewed     |
| Free-text mode column validated at runtime            | Rejected | A typo or a new value slips in without review; no type-level guarantee                 |
| Per-adapter boolean "allowed" with no mode            | Rejected | Cannot express _how_ data is obtained, so cannot distinguish lawful from unlawful uses |

## Decision

- Access modes are exactly these five, in code (`ACCESS_MODES` in `packages/flags/src/access-mode.ts`) and in the Postgres enum `access_mode` (migration `0011_flags`):
  - `user_supplied`: the lawyer supplies the data (upload, paste, forward, share).
  - `device_user_triggered`: the lawyer's own device fetches it on their explicit action, with their session; never on our servers, never scheduled.
  - `official`: an official feed or API the court publishes for this use.
  - `licensed`: data obtained under a written licence or agreement with the source.
  - `none`: no access; always denied.
- No mode permits automated server-side retrieval from court sites without authorisation, scraping, crawling or captcha circumvention, and none will be added.
- `assertAccessMode({adapterId, resource, requestedMode})` throws `ACCESS_MODE_DENIED` unless `access_mode_registry` has an enabled row for the adapter's resource whose mode equals the requested one. Rows default to disabled.
- `packages/flags/src/__tests__/access-mode-guard.test.ts` pins the list against the type, the schema enum and every migration, rejects names that suggest scraping or circumvention, and requires every mode to be named in an ADR. Adding a mode needs a new ADR that supersedes this one.

## Consequences

- Positive: a court-adapter capability is off until a reviewed, enabled registry row allows it; CI blocks unreviewed modes.
- Negative: adding a lawful new mode needs an ADR and a migration that alters the enum.

## Revisit when

- Counsel's access-mode memo (needs-human) asks for a mode this list cannot express.
- A court publishes a new kind of authorised channel that does not fit `official` or `licensed`.

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- [ADR 0010](0010-feature-flags-db-backed-legal-gating-and-no-l5.md)
- [Feature flags guide](../engineering/flags.md)
- Issues: #22 (enforcement), #35 (adapter framework), #120 (counsel unlocks)
