# 0010. DB-backed feature flags, legal gating and no L5 actions

## Status

Accepted

## Date

2026-10-18

## Context

The full product is built now (D-041), but some features need counsel review (⚖) before they can be switched on: fees and invoices, limitation, inbound enquiries, client status links and A2 retrieval (D-040). The automation ladder stops at L4. L5 (autonomous outward or legal action, such as auto-sending to a client, auto-filing or giving advice) is prohibited permanently. The spike fixes this in [§1](../engineering/13-technical-architecture-spike.md#1-stack-decisions) (Feature flags row), [§5](../engineering/13-technical-architecture-spike.md#5-domain-services-packagescore) (Automation engine and Outward drafts), its permanent exclusions, and the [09 §4 approval matrix](../product/09-zero-entry-automation-design.md#4-the-automation-ladder--approval-boundaries).

## Decision drivers

- Build and merge legally gated code without exposing it.
- Switch features per workspace (pilots) and switch them off globally in an incident.
- Make the L5 prohibition impossible to break by accident.

## Considered options

| Option                                            | Verdict  | Reason                                                                                                |
| ------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| DB-backed per-workspace flags + env kill-switches | Chosen   | Flags live in our India database next to tenant data; kill-switches work even when the DB is degraded |
| Hosted flag service (LaunchDarkly or similar)     | Rejected | Workspace identifiers and targeting data go to a third party outside India; cost                      |
| Env-only flags                                    | Rejected | No per-workspace pilots; every change is a deploy                                                     |
| Flags in config files in the repo                 | Rejected | Every change is a deploy; no per-workspace control                                                    |

## Decision

- `packages/flags` stores flags per workspace in Postgres. Environment kill-switches override them globally.
- **Legal-gated (⚖) features are off by default and ship dark.** They are switched on only after the counsel deliverable that unlocks them (tracked as `needs-human`).
- The automation engine supports L1–L4 only. **No L5 action type exists**, and a static check fails the build if one is added (implemented with the automation engine, issue #47).
- **No auto-send.** Outward drafts (client, senior, counsel updates) have no send path. The lawyer sends them.
- **No training on customer data** and **India-only AI by default** apply to every flagged feature too ([ADR 0007](0007-ai-gateway-india-only-mode-no-training-no-tools.md)). No flag can turn them off.

## Consequences

- Positive: legally gated work merges continuously without exposure. Incidents have a global off switch.
- Negative: flag checks spread across code paths, so stale flags must be removed after launch.
- Negative: the no-L5 check constrains how action types are modelled (a closed, statically known set).

## Revisit when

- Counsel unlocks a gated feature (issue #120). Its default then changes, and the flag is eventually removed.
- Flag evaluation shows up in latency (spike §3.2 Stage B: p95 > 400 ms). A cache would then be needed, from Redis at Stage C.
- Never for L5, auto-send or training on customer data: these are permanent exclusions and are not revisited by ADR.

## Links

- [Spike §5](../engineering/13-technical-architecture-spike.md#5-domain-services-packagescore)
- [ADR 0007](0007-ai-gateway-india-only-mode-no-training-no-tools.md)
- Issues: #22 (flags), #47 (no-L5 static check), #120 (counsel unlocks)
- [DECISIONS.md](../../DECISIONS.md) D-040, D-041
