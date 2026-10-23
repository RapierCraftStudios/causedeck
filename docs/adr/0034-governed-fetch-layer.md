# 0034. Governed fetch layer

## Status

Proposed

## Date

2026-10-23

## Context

Every external read (court pages, notices, news, licensed feeds) must obey the source registry (#478, D-048): cleared by counsel, kill switch honoured, rate-limited, cost-capped and traceable. AlterLab is the scraping provider (D-048); its `captcha` tier solves challenges and is a legal risk for court and government pages, so the database already refuses to store `captcha` as the `max_tier` of a court or notice source (`source_no_captcha_chk`).

## Decision drivers

- No external read may bypass the registry, and a killed source must stop on the next call.
- The captcha tier is off by default for court and government sources.
- The layer must run offline in every test, with no API key.
- `@causedeck/core` will consume the layer, so the layer must not import core or db.

## Considered options

| Option                                                          | Verdict  | Reason                                                                        |
| --------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------- |
| `packages/fetch` with injected registry, provider, clock, sinks | Chosen   | One choke point, no import cycle, testable with fakes                         |
| Each adapter calls AlterLab itself                              | Rejected | No single place to enforce clearance, caps or the kill switch                 |
| Store `captcha` on court rows when allowed                      | Rejected | Conflicts with `source_no_captcha_chk`; a stored raise outlives its clearance |

## Decision

All external reads go through `fetchSource(sourceId, url, opts)` in `@causedeck/fetch`. Enforcement order:

1. `registry.policyFor(sourceId)` on every call. An unknown, uncleared or killed source throws before any network call.
2. The URL must be http(s) and its host must match the policy `baseUrl`.
3. The per-source limiter (`rateLimitPerMinute`), then, for a delegated `captcha` lookup, the per-advocate limiter (`FETCH_DELEGATED_CAPTCHA_PER_HOUR`, default 10).
4. The captcha gate: for `court` and `notice` sources the tier cap is `proxy` unless the call carries `delegatedFor: { advocateId, matterId }` or the registry row has `captcha_bulk_cleared` (counsel clearance for bulk solving). The raised cap is computed in code and never stored.
5. The provider is called with `proxyCountry: 'IN'`, `failFast: true`, the effective `maxTier` and `maxCostDollars`.
6. The result carries provenance (url, fetchedAt, sha256 of the body, sourceId, sourceVersion, tierUsed, costDollars). A `fetch_log` row is written and cost is reported to the usage sink; a provider that overshoots a cap is an error.

The `alterlab` SDK is imported only by `packages/fetch/src/providers/alterlab.ts`; an ESLint rule and `static-checks.test.ts` forbid other imports and `fetch` of a literal external host. With no `ALTERLAB_API_KEY` the deterministic mock provider serves fixtures at zero cost. `fetch_log` is global and holds ids, a URL hash, status, tier and cost only, never content.

## Consequences

- Positive: one enforced path; the kill switch and clearance take effect at once; tests run offline.
- Negative: the limiter is in memory, so limits hold per process, not across workers (accepted until a shared limiter is needed). Per-workspace usage metering is left to callers that know a workspace.

## Revisit when

- More than one worker or web process fetches the same source (move the limiter to Postgres or Redis).
- Counsel clears bulk captcha solving for a court source.

## Links

- [Technical architecture spike](../engineering/13-technical-architecture-spike.md)
- [0011. Access-mode registry closed enum](0011-access-mode-registry-closed-enum.md)
