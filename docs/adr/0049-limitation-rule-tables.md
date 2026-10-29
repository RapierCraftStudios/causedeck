# 0049. Limitation rule tables and reviewed-only platform rules

## Status

Proposed

## Date

2026-10-28

## Context

The limitation tracker (#84) computes the last day to file from a rule table that counsel supplies and signs off (#120). A rule that counsel has not reviewed must never reach a workspace, yet counsel's rules are platform-wide, while a firm may also hold rules of its own. Part 1 adds the data layer only; the engine, pages and staff import follow in #940 to #942. The gate is the existing flag `limitation.enabled` ([flags](../engineering/flags.md)); no second flag is added.

## Decision drivers

- An unreviewed rule is never readable by a workspace.
- One table serves platform and workspace rules, as the court reference tables do ([ADR-0013](0013-matter-graph-schema.md)).
- A computation is workspace data and is isolated like any other tenant row.

## Considered options

| Option                                                        | Verdict  | Reason                                                                     |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| Global-or-workspace `limitation_rule` with reviewed-only read | Chosen   | Reuses the proven scope model; the policy itself enforces counsel's review |
| Filter on `reviewed` in application code                      | Rejected | One missed query would expose an unreviewed rule                           |
| Separate platform and workspace rule tables                   | Rejected | Two schemas and two readers for the same shape                             |

## Decision

- `limitation_rule` is built with `globalOrWorkspaceTable()`: a null `workspace_id` is a platform rule, written only by the owner role (`owner_catalogue`). Its stock `global_read` policy is narrowed by a restrictive `reviewed_only` SELECT policy (`workspace_id IS NOT NULL OR reviewed`, with the owner role exempt so staff can import and review), and a CHECK requires `reviewed_at` whenever `reviewed` is true. A workspace's own rules follow `ws_isolation`.
- `limitation_computation` is a tenant table under FORCE RLS. Its `rule_id` is a single-column FK guarded by `app_reference_scope_guard` in mode `same_or_global`, so it can cite a platform rule or its own workspace's rule and no other.
- Export and erasure cover a workspace's own rules and computations; platform rules are never matched.
- The zod shapes live in `@causedeck/validators/limitation`; the db CHECK lists mirror them.

## Consequences

- Positive: an unreviewed rule is invisible to every workspace by policy.
- Negative: a platform rule needs a review date before it can be marked reviewed; staff import (#942) must set both together.

## Revisit when

- Counsel changes the review model (for example per-rule expiry of a review).

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
